import { MAX_QUANTITY_PER_ITEM, type CreateOrderInput } from '../schemas/order.schema';
import type { AuthUser } from '../types/auth';
import type { Tables } from '../types/database';
import { ORDER_STATUSES, type OrderStatus } from '../types/enums';
import { invalidate } from '../utils/cache';
import {
  AppError,
  idempotencyKeyReused,
  insufficientStock,
  notFound,
  validationError,
} from '../utils/errors';
import { isUuid } from '../utils/ids';
import { selectOrders, type OrderWithDetails } from '../utils/serializers';
import { raisedByDatabase, supabaseAdmin } from '../utils/supabase';
import { simulatePayment } from './payment.service';
import { getSettings } from './settings.service';
import { getStore } from './store.service';

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

/** One priced line, in the shape the place_order database function takes. */
type OrderLine = {
  menu_item_id: string;
  name: string;
  unit_price: number;
  quantity: number;
};

/** What createOrder placed, and whether it was placed now or already existed under the same idempotency key. */
interface PlacedOrder {
  order: OrderWithDetails;
  replayed: boolean;
}

/**
 * Places a paid order. Prices are read from the database, never from the request:
 * store must be open -> validate items -> price lines -> total -> simulated payment -> place_order.
 * A repeated `idempotencyKey` returns the order that key already placed (the fast path below; place_order settles
 * the race of two simultaneous repeats), so a retry after a lost response never charges or reserves twice.
 *
 * place_order reserves the stock and writes the order in ONE transaction, so a refused order (sold out)
 * leaves no order rows and no stock decrements behind.
 */
export async function createOrder(user: AuthUser, input: CreateOrderInput): Promise<PlacedOrder> {
  if (input.idempotencyKey) {
    const { data: existing } = await selectOrders()
      .eq('user_id', user.id)
      .eq('idempotency_key', input.idempotencyKey)
      .maybeSingle()
      .throwOnError();
    if (existing) {
      if (!matchesRequest(existing, input)) {
        throw idempotencyKeyReused(existing.id, existing.order_number);
      }
      return { order: existing, replayed: true };
    }
  }

  // A site setting, read through the cache: an admin's change can take up to the 10 s TTL on other instances, which is
  // harmless for a cap this generous.
  const { max_lines_per_order: maxLines } = await getSettings();
  if (input.lineCount > maxLines)
    throw validationError(`An order can have at most ${maxLines} items.`);

  const store = await getStore();
  if (!store.is_open) {
    throw new AppError(
      400,
      'STORE_CLOSED',
      `${store.name} is closed right now. Please come back when it opens.`,
    );
  }
  const customerName = input.customerName ?? (await lookupUserName(user.id));

  // Ids that are not UUIDs (e.g. a cart saved before the move to Supabase) cannot exist, so they are not queried.
  const ids = input.items.map((line) => line.menuItemId).filter(isUuid);
  const { data: menuItems } = await supabaseAdmin
    .from('menu_items')
    .select()
    .in('id', ids)
    .throwOnError();
  const byId = new Map(menuItems.map((item) => [item.id, item]));

  const lines = priceLines(input.items, byId);
  const total = lines.reduce((sum, line) => sum + line.unit_price * line.quantity, 0);
  // A real gateway would be charged here. With one, a sold-out refusal from place_order must refund the charge.
  const paymentStatus = await simulatePayment(total);

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
    throw err;
  } finally {
    // Placed or refused for stock, the cached menu's stock counts are out of date either way.
    invalidate('menu');
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
 * Both lists are polled, so both are bounded to the newest orders. The sizes are site settings (admin dashboard):
 * a customer sees their newest `customer_order_history_limit`, staff the newest `staff_order_list_limit` across
 * everyone. Newest first.
 */
export async function listOrders(
  user: AuthUser,
  status?: OrderStatus,
): Promise<OrderWithDetails[]> {
  const settings = await getSettings();
  if (user.role === 'STAFF') return listStaffOrders(settings.staff_order_list_limit, status);

  let query = selectOrders()
    .order('created_at', { ascending: false })
    .eq('user_id', user.id)
    .limit(settings.customer_order_history_limit);
  if (status) query = query.eq('status', status);
  const { data: orders } = await query.throwOnError();
  return orders;
}

/**
 * The kitchen board: every active order, and the newest `finishedLimit` finished ones (collected, cancelled) as
 * history. One limit over every status used to cut the orders that had waited longest as soon as enough newer orders
 * existed, collected ones included, with nothing on the board to say so. Newest first, as before; the board sorts.
 */
async function listStaffOrders(
  finishedLimit: number,
  status?: OrderStatus,
): Promise<OrderWithDetails[]> {
  const active = async (statuses: OrderStatus[]) =>
    (
      await selectOrders()
        .in('status', statuses)
        .order('created_at', { ascending: true })
        .limit(ACTIVE_ORDERS_HARD_MAX)
        .throwOnError()
    ).data;
  const finished = async (statuses: OrderStatus[]) =>
    (
      await selectOrders()
        .in('status', statuses)
        .order('created_at', { ascending: false })
        .limit(finishedLimit)
        .throwOnError()
    ).data;

  if (status)
    return ACTIVE_STATUSES.includes(status)
      ? (await active([status])).reverse()
      : finished([status]);
  const [open, done] = await Promise.all([active(ACTIVE_STATUSES), finished(TERMINAL_STATUSES)]);
  return [...open, ...done].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Someone else's order looks exactly like a missing one (404), so ids cannot be probed. */
export async function getOrder(user: AuthUser, id: string): Promise<OrderWithDetails> {
  if (!isUuid(id)) throw notFound('Order not found.');

  let query = selectOrders().eq('id', id);
  if (user.role !== 'STAFF') query = query.eq('user_id', user.id);

  const { data: order } = await query.maybeSingle().throwOnError();
  if (!order) throw notFound('Order not found.');
  return order;
}

/**
 * update_order_status is one conditional update, so two staff devices cannot overwrite each other:
 * the row only changes if its status is still one that ALLOWED_TRANSITIONS lets move to `nextStatus`.
 * Cancelling also puts the order's items back in stock, in the same transaction.
 */
export async function updateOrderStatus(
  id: string,
  nextStatus: OrderStatus,
): Promise<OrderWithDetails> {
  if (!isUuid(id)) throw notFound('Order not found.');

  try {
    await supabaseAdmin
      .rpc('update_order_status', {
        p_order_id: id,
        p_next_status: nextStatus,
        p_from_statuses: statusesLeadingTo(nextStatus),
      })
      .throwOnError();
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
  // Cancelling puts the items back in stock.
  if (nextStatus === 'CANCELLED') invalidate('menu');

  const { data: order } = await selectOrders().eq('id', id).single().throwOnError();
  return order;
}

/** Every status from which staff may move an order to `target`. */
function statusesLeadingTo(target: OrderStatus): OrderStatus[] {
  return ORDER_STATUSES.filter((from) => ALLOWED_TRANSITIONS[from].includes(target));
}

/**
 * Snapshots each requested item's current name and price. Every refusal names the item (or, when the
 * item is gone, identifies it by id) so the client can point at the exact cart line.
 * Items arrive already merged by the schema, so the quantity cap applies to the real total per item.
 */
function priceLines(
  requested: CreateOrderInput['items'],
  byId: Map<string, MenuItem>,
): OrderLine[] {
  return requested.map(({ menuItemId, quantity }) => {
    const item = byId.get(menuItemId);
    if (!item) {
      throw new AppError(400, 'ITEM_NOT_FOUND', 'One of the items is no longer on the menu.', {
        menuItemId,
        available: 0,
      });
    }
    if (!item.is_available) {
      throw new AppError(
        400,
        'ITEM_UNAVAILABLE',
        `${item.name} is currently unavailable. Please remove it from your cart.`,
        { menuItemId, name: item.name, available: 0 },
      );
    }
    if (quantity > MAX_QUANTITY_PER_ITEM) {
      throw validationError(
        `You can order at most ${MAX_QUANTITY_PER_ITEM} of ${item.name}. Please reduce the quantity in your cart.`,
      );
    }
    return { menu_item_id: menuItemId, name: item.name, unit_price: item.price, quantity };
  });
}

async function lookupUserName(userId: string): Promise<string> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('name')
    .eq('id', userId)
    .single()
    .throwOnError();
  return profile.name;
}
