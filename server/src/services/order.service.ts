import { accessFor, can, type Capability } from '../domain/permissions';
import { LIMITS } from '../schemas/limits';
import { type CreateOrderInput } from '../schemas/order.schema';
import type { AuthUser, RequestContext } from '../types/auth';
import type { Tables } from '../types/database';
import { ORDER_STATUSES, type OrderStatus } from '../types/enums';
import {
  AppError,
  idempotencyKeyReused,
  insufficientStock,
  itemUnavailable,
  notFound,
  priceChanged,
  storeClosed,
  validationError,
} from '../utils/errors';
import { isUuid } from '../utils/ids';
import { paiseToRupees } from '../utils/money';
import { selectOrders, type OrderWithDetails } from '../utils/serializers';
import { raisedByDatabase, supabaseAdmin } from '../utils/supabase';
import { invalidate } from '../utils/cache';
import { invalidateMenus } from './menu.service';
import { simulatePayment } from './payment.service';
import { getSettings } from './settings.service';
import { getStore } from './store.service';
import { getStoreSettings } from './storeSettings.service';

/** The single source of truth for which status changes staff may make. */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PLACED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COLLECTED'],
  COLLECTED: [],
  CANCELLED: [],
};

/** Statuses with somewhere left to go: the kitchen's live work (derived, so a new status is never forgotten). */
const ACTIVE_STATUSES = ORDER_STATUSES.filter((s) => ALLOWED_TRANSITIONS[s].length > 0);
const TERMINAL_STATUSES = ORDER_STATUSES.filter((s) => ALLOWED_TRANSITIONS[s].length === 0);

/**
 * A safety bound on active orders per staff request, far above any café's queue. Oldest first, so if it is ever hit
 * the newest wait, never the ones that have waited longest.
 */
const ACTIVE_ORDERS_HARD_MAX = 500;

type MenuItem = Tables<'menu_items'>;

/**
 * One checked line, in the shape the place_order database function takes. `unit_price_paise` is the price this request
 * charged for: place_order stores its own read of menu_items and refuses the order (PRICE_CHANGED) if that differs.
 */
type OrderLine = {
  menu_item_id: string;
  name: string;
  quantity: number;
  unit_price_paise: number;
};

/** What createOrder placed, and whether it was placed now or already existed under the same idempotency key. */
interface PlacedOrder {
  order: OrderWithDetails;
  replayed: boolean;
}

interface UpdatedOrder {
  order: OrderWithDetails;
  /** It already had this status (a retried request, a second device): nothing changed and nothing was emitted. */
  repeated: boolean;
}

/**
 * Places a paid order. Prices are read from the database, never from the request:
 * store must be open -> validate items -> price lines (and match any price the customer saw) -> total ->
 * simulated payment -> place_order, which checks the store, availability and prices again under its own locks.
 * A repeated `idempotencyKey` returns the order that key already placed (the fast path below; place_order settles
 * the race of two simultaneous repeats), so a retry after a lost response never charges or reserves twice.
 *
 * place_order reserves the stock and writes the order in ONE transaction, so a refused order (sold out, or a price
 * changed since the charge) leaves no order rows and no stock decrements behind.
 */
export async function createOrder(
  user: AuthUser,
  input: CreateOrderInput,
  ctx: RequestContext,
): Promise<PlacedOrder> {
  // Ids that are not UUIDs (e.g. a cart saved before the move to Supabase) cannot exist, so they are not queried.
  const ids = input.items.map((line) => line.menuItemId).filter(isUuid);
  // None of these reads depends on another, so they go out together: one round trip to the database instead of one
  // each (test/api/order-reads.test.ts). The checks below still run in the same order.
  const [existing, settings, store, customerName, menuItems] = await Promise.all([
    input.idempotencyKey
      ? selectOrders()
          .eq('user_id', user.id)
          .eq('idempotency_key', input.idempotencyKey)
          .maybeSingle()
          .throwOnError()
          .then(({ data }) => data)
      : null,
    // A site setting, read through the cache: an admin's change can take up to the 10 s TTL on other instances, which
    // is harmless for a cap this generous.
    getSettings(),
    getStore(input.storeId),
    input.customerName ?? lookupUserName(user.id),
    supabaseAdmin
      .from('menu_items')
      .select()
      .in('id', ids)
      .throwOnError()
      .then(({ data }) => data),
  ]);

  // A replay answers the order the key placed, even at a store that has stopped trading since.
  if (existing && existing.store_id === store.id && matchesRequest(existing, input))
    return { order: existing, replayed: true };
  // A store that is not trading (a draft, suspended, archived) takes no orders and is not there to the public: refused
  // before any other check, so no answer tells it apart from an unknown id.
  if (store.status !== 'ACTIVE') throw notFound('Store not found.');
  // The same key at another store, or for another order, is never a replay.
  if (existing) throw idempotencyKeyReused(existing.id, existing.order_number);

  const maxLines = settings.max_lines_per_order;
  if (input.lineCount > maxLines)
    throw validationError(`An order can have at most ${maxLines} items.`);

  if (!store.is_open) throw storeClosed(store.name);
  // Another store's item is not on this store's menu: it is "not found" here, so an order never mixes stores and
  // never draws down another store's stock.
  const byId = new Map(
    menuItems.filter((item) => item.store_id === store.id).map((item) => [item.id, item]),
  );

  const { lines, totalPaise } = priceLines(
    input.items,
    byId,
    store.id,
    store.max_quantity_per_item,
  );
  // A real gateway would be charged here. With one, a refusal from place_order (sold out, price changed) must refund it.
  const paymentStatus = await simulatePayment(totalPaise);

  let orderId: string;
  try {
    ({ data: orderId } = await supabaseAdmin
      .rpc('place_order', {
        p_user_id: user.id,
        p_store_id: store.id,
        p_customer_name: customerName,
        p_customer_phone: input.customerPhone,
        p_note: input.note,
        p_payment_status: paymentStatus,
        p_lines: lines,
        p_idempotency_key: input.idempotencyKey,
        // Recorded with the order.placed event the function emits in the same transaction.
        p_actor: ctx.actor,
        p_request_id: ctx.requestId,
      })
      .throwOnError());
  } catch (err) {
    // The loser of a race for the last units is told exactly which item and how many are left.
    const stock = raisedByDatabase(err, 'INSUFFICIENT_STOCK');
    if (stock)
      throw insufficientStock(
        String(stock.menuItemId),
        String(stock.name),
        Number(stock.available),
      );
    // The price moved after this request charged for it: nothing was placed, and the customer sees the new price.
    const changed = raisedByDatabase(err, 'PRICE_CHANGED');
    if (changed)
      throw priceChanged(String(changed.menuItemId), String(changed.name), Number(changed.price));
    // Switched off or closed after the checks above: the same refusals those checks give.
    const unavailable = raisedByDatabase(err, 'ITEM_UNAVAILABLE');
    if (unavailable)
      throw itemUnavailable(String(unavailable.menuItemId), String(unavailable.name));
    if (raisedByDatabase(err, 'STORE_CLOSED')) throw storeClosed(store.name);
    throw err;
  } finally {
    // Placed or refused for stock, the cached menu's stock counts are out of date either way.
    invalidateMenus(store.id);
  }

  const { data: order } = await selectOrders().eq('id', orderId).single().throwOnError();
  // place_order answers a key it already saw (two requests racing past the check above) with the stored order, which
  // must be the same order this request asked for.
  if (input.idempotencyKey && !matchesRequest(order, input, customerName)) {
    throw idempotencyKeyReused(order.id, order.order_number);
  }
  return { order, replayed: false };
}

/**
 * Whether a stored order is what this request asks for: the same items and quantities (after merging), and the same
 * pickup details. `customerName` is the resolved name; without it, a request that sent none matches any name.
 */
function matchesRequest(
  order: OrderWithDetails,
  input: CreateOrderInput,
  customerName = input.customerName,
): boolean {
  const stored = new Map(order.order_items.map((line) => [line.menu_item_id, line.quantity]));
  const sameItems =
    input.items.length === stored.size &&
    input.items.every((line) => stored.get(line.menuItemId) === line.quantity);
  return (
    sameItems &&
    (customerName === undefined || customerName === order.customer_name) &&
    (input.customerPhone ?? null) === order.customer_phone &&
    (input.note ?? null) === order.note
  );
}

/**
 * GET /api/orders. Both lists are polled, so both are bounded to the newest orders. The sizes are site settings (admin
 * dashboard): a customer sees their newest `customer_order_history_limit`; a STAFF profile, until P2 PR 16, the board
 * of every store they work at, as a member or as its brand's owner (listStoreOrders), so the list matches the orders
 * getOrder and updateOrderStatus let them reach. Newest first.
 */
export async function listOrders(
  user: AuthUser,
  status?: OrderStatus,
): Promise<OrderWithDetails[]> {
  if (user.role === 'STAFF') return listStoreOrders(await storesWorkedAt(user), status);

  const settings = await getSettings();
  let query = selectOrders()
    .order('created_at', { ascending: false })
    .eq('user_id', user.id)
    .limit(settings.customer_order_history_limit);
  if (status) query = query.eq('status', status);
  const { data: orders } = await query.throwOnError();
  return orders;
}

/** The stores where the caller has a store standing: their memberships, and every store of a brand they own. */
async function storesWorkedAt(user: AuthUser): Promise<string[]> {
  const ids = user.memberships.map((m) => m.storeId);
  if (user.ownedBrandIds.length === 0) return ids;
  const { data: owned } = await supabaseAdmin
    .from('stores')
    .select('id')
    .in('brand_id', user.ownedBrandIds)
    .throwOnError();
  return [...new Set([...ids, ...owned.map((store) => store.id)])];
}

/**
 * The kitchen board of `storeIds` (the caller was admitted to each): every active order, and the newest
 * store's `staff_order_list_limit` finished ones (collected, cancelled) as history. One limit over every status used to cut the
 * orders that had waited longest as soon as enough newer orders existed, collected ones included, with nothing on the
 * board to say so. Newest first, as before; the board sorts.
 */
export async function listStoreOrders(
  storeIds: string[],
  status?: OrderStatus,
): Promise<OrderWithDetails[]> {
  if (storeIds.length === 0) return [];
  const active = async (statuses: OrderStatus[]) =>
    (
      await selectOrders()
        .in('store_id', storeIds)
        .in('status', statuses)
        .order('created_at', { ascending: true })
        .limit(ACTIVE_ORDERS_HARD_MAX)
        .throwOnError()
    ).data;
  const finished = async (statuses: OrderStatus[]) =>
    // Each store keeps its own number of finished orders (its settings), so one query per store.
    // ponytail: N queries per poll for a caller at N stores; one windowed RPC if owners run many stores.
    (
      await Promise.all(
        storeIds.map(async (id) =>
          selectOrders()
            .eq('store_id', id)
            .in('status', statuses)
            .order('created_at', { ascending: false })
            .limit((await getStoreSettings(id)).staff_order_list_limit)
            .throwOnError(),
        ),
      )
    ).flatMap(({ data }) => data);

  if (status)
    return ACTIVE_STATUSES.includes(status)
      ? (await active([status])).reverse()
      : (await finished([status])).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const [open, done] = await Promise.all([active(ACTIVE_STATUSES), finished(TERMINAL_STATUSES)]);
  return [...open, ...done].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * The customer who placed it, or a caller whose access at its store holds `orders.view`. Any other order looks exactly
 * like a missing one (404), so ids cannot be probed.
 */
export async function getOrder(user: AuthUser, id: string): Promise<OrderWithDetails> {
  if (!isUuid(id)) throw notFound('Order not found.');
  const { data: order } = await selectOrders().eq('id', id).maybeSingle().throwOnError();
  if (!order) throw notFound('Order not found.');
  if (order.user_id !== user.id) accessToOrder(user, order, 'orders.view');
  return order;
}

/**
 * The caller's access at the order's store, when it holds `capability`; otherwise the order is not theirs to know
 * about, 404 like a missing one (CLAUDE.md §10), even where the store itself would answer 403.
 */
function accessToOrder(
  user: AuthUser,
  order: { store_id: string; store: { brand_id: string } },
  capability: Capability,
) {
  const access = accessFor(user, { id: order.store_id, brandId: order.store.brand_id }, capability);
  if (access === null || !can(access, capability)) throw notFound('Order not found.');
  return access;
}

/**
 * update_order_status locks the order and checks its status in one transaction, so two staff devices cannot overwrite
 * each other: the row only changes if its status is still one that ALLOWED_TRANSITIONS lets move to `nextStatus`.
 * A repeat of a change that already happened (a retried request, a second device) answers with the order unchanged.
 * Cancelling also puts the order's items back in stock, and every change emits its `order.<status>` event, all in the
 * same transaction.
 */
export async function updateOrderStatus(
  user: AuthUser,
  id: string,
  nextStatus: OrderStatus,
  requestCtx: RequestContext,
  /** The store route's store: an order of any other store is 404 there. */
  storeId?: string,
): Promise<UpdatedOrder> {
  if (!isUuid(id)) throw notFound('Order not found.');
  // The order's store decides who may move it. Its store never changes, so reading it first leaves no race.
  const { data: placed } = await supabaseAdmin
    .from('orders')
    .select('store_id, store:stores!inner (brand_id)')
    .eq('id', id)
    .maybeSingle()
    .throwOnError();
  if (!placed || (storeId !== undefined && placed.store_id !== storeId))
    throw notFound('Order not found.');
  const access = accessToOrder(user, placed, 'orders.transition');
  // The old route has no requireStore: the audit row and the event still record the caller's standing at the store.
  const ctx = { ...requestCtx, actor: { ...requestCtx.actor, storeRole: access } };

  let changed: boolean;
  try {
    ({ data: changed } = await supabaseAdmin
      .rpc('update_order_status', {
        p_order_id: id,
        p_next_status: nextStatus,
        p_from_statuses: statusesLeadingTo(nextStatus),
        p_actor: ctx.actor,
        p_request_id: ctx.requestId,
      })
      .throwOnError());
  } catch (err) {
    if (raisedByDatabase(err, 'NOT_FOUND')) throw notFound('Order not found.');
    const current = raisedByDatabase(err, 'INVALID_STATUS_TRANSITION');
    if (current) {
      throw new AppError(
        409,
        'INVALID_STATUS_TRANSITION',
        `Order #${String(current.orderNumber)} cannot move from ${String(current.status)} to ${nextStatus}.`,
      );
    }
    throw err;
  }
  // Cancelling puts the items back in stock (a repeated cancel moved nothing, so a retry would not get here again).
  const restocked = changed && nextStatus === 'CANCELLED';
  let order: OrderWithDetails;
  try {
    ({ data: order } = await selectOrders().eq('id', id).single().throwOnError());
  } catch (err) {
    // The re-read names the order's store; without it, drop every cached read rather than leave a menu showing the
    // restocked items as sold out until its TTL.
    if (restocked) invalidate();
    throw err;
  }
  if (restocked) invalidateMenus(order.store_id);
  return { order, repeated: !changed };
}

/** Every status from which staff may move an order to `target`. */
function statusesLeadingTo(target: OrderStatus): OrderStatus[] {
  return ORDER_STATUSES.filter((from) => ALLOWED_TRANSITIONS[from].includes(target));
}

/**
 * Checks each requested item and prices the order in paise from the items just read, for the payment. Every refusal
 * names the item (or, when the item is gone, identifies it by id) so the client can point at the exact cart line.
 * Items arrive already merged by the schema, so the quantity cap applies to the real total per item.
 */
function priceLines(
  requested: CreateOrderInput['items'],
  byId: Map<string, MenuItem>,
  storeId: string,
  maxQuantity: number,
): { lines: OrderLine[]; totalPaise: number } {
  let totalPaise = 0;
  const lines = requested.map(({ menuItemId, quantity, expectedUnitPrices }) => {
    const item = byId.get(menuItemId);
    if (!item) {
      throw new AppError(400, 'ITEM_NOT_FOUND', 'One of the items is no longer on the menu.', {
        menuItemId,
        available: 0,
      });
    }
    if (!item.is_available) throw itemUnavailable(menuItemId, item.name);
    if (quantity > maxQuantity) {
      throw validationError(
        `You can order at most ${maxQuantity} of ${item.name}. Please reduce the quantity in your cart.`,
      );
    }
    // The customer saw another price (a cart kept from before a price change): refused before any charge.
    const price = paiseToRupees(item.price_paise);
    if (expectedUnitPrices.some((expected) => expected !== price)) {
      // The checkout reloads the menu after this refusal: a cached menu would show the old price and be refused again.
      invalidateMenus(storeId);
      throw priceChanged(menuItemId, item.name, price);
    }
    totalPaise += item.price_paise * quantity;
    return {
      menu_item_id: menuItemId,
      name: item.name,
      quantity,
      unit_price_paise: item.price_paise,
    };
  });
  return { lines, totalPaise };
}

async function lookupUserName(userId: string): Promise<string> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('name')
    .eq('id', userId)
    .single()
    .throwOnError();
  // A profile made before handle_new_user bounded the name may hold a longer one; the order still gets a valid name,
  // and the cut never leaves half of a surrogate pair (a lone surrogate is not valid JSON for the RPC).
  const name = profile.name.slice(0, LIMITS.nameMax);
  return /[\uD800-\uDBFF]$/.test(name) ? name.slice(0, -1) : name;
}
