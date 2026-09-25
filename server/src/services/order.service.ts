import { OrderStatus, Role, type MenuItem, type Prisma } from '@prisma/client';
import { MAX_QUANTITY_PER_ITEM, type CreateOrderInput } from '../schemas/order.schema';
import type { AuthUser } from '../types/auth';
import { AppError, insufficientStock, notFound, validationError } from '../utils/errors';
import { prisma } from '../utils/prisma';
import { orderInclude, type OrderWithDetails } from '../utils/serializers';
import { simulatePayment } from './payment.service';
import { getStore } from './store.service';

/** The single source of truth for which status changes staff may make. */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PLACED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

/** Staff poll the list every few seconds, so it is bounded to the newest orders. */
const STAFF_LIST_LIMIT = 100;

type OrderLine = Prisma.OrderItemUncheckedCreateWithoutOrderInput;
type Db = Prisma.TransactionClient;

/**
 * Places a paid order. Prices are read from the database, never from the request:
 * store must be open -> validate items -> reserve stock -> price lines -> total -> simulated payment -> one create.
 *
 * Everything from the stock check on runs in ONE transaction, so a refused order (sold out, payment failed)
 * leaves no order rows and no stock decrements behind.
 */
export async function createOrder(user: AuthUser, input: CreateOrderInput): Promise<OrderWithDetails> {
  const store = await getStore();
  if (!store.isOpen) {
    throw new AppError(400, 'STORE_CLOSED', `${store.name} is closed right now. Please come back when it opens.`);
  }
  const customerName = input.customerName ?? (await lookupUserName(user.id));

  return prisma.$transaction(async (tx) => {
    const menuItems = await tx.menuItem.findMany({ where: { id: { in: input.items.map((line) => line.menuItemId) } } });
    const byId = new Map(menuItems.map((item) => [item.id, item]));

    const lines = priceLines(input.items, byId);
    await reserveStock(tx, lines, byId);

    const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    // A real gateway would be charged here, after the stock is held and before the order exists.
    const paymentStatus = await simulatePayment(total);
    const createdAt = new Date();

    return tx.order.create({
      data: {
        userId: user.id,
        storeId: store.id,
        customerName,
        customerPhone: input.customerPhone ?? null,
        note: input.note ?? null,
        total,
        paymentStatus,
        status: OrderStatus.PLACED,
        createdAt,
        estimatedReadyAt: addMinutes(createdAt, store.prepTimeMaxMinutes),
        items: { create: lines },
      },
      include: orderInclude,
    });
  });
}

/** Customers see all of their own orders; staff see the newest STAFF_LIST_LIMIT across everyone. Newest first. */
export async function listOrders(user: AuthUser, status?: OrderStatus): Promise<OrderWithDetails[]> {
  return prisma.order.findMany({
    where: { ...visibleTo(user), status },
    orderBy: { createdAt: 'desc' },
    take: user.role === Role.STAFF ? STAFF_LIST_LIMIT : undefined,
    include: orderInclude,
  });
}

/** Someone else's order looks exactly like a missing one (404), so ids cannot be probed. */
export async function getOrder(user: AuthUser, id: string): Promise<OrderWithDetails> {
  const order = await prisma.order.findFirst({ where: { id, ...visibleTo(user) }, include: orderInclude });
  if (!order) throw notFound('Order not found.');
  return order;
}

/**
 * One conditional update, so two staff devices cannot overwrite each other:
 * the row only changes if its status is still one that ALLOWED_TRANSITIONS lets move to `nextStatus`.
 * Cancelling also puts the order's items back in stock, in the same transaction.
 */
export async function updateOrderStatus(id: string, nextStatus: OrderStatus): Promise<OrderWithDetails> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.order.updateMany({
      where: { id, status: { in: statusesLeadingTo(nextStatus) } },
      data: { status: nextStatus },
    });

    if (count === 0) {
      const order = await tx.order.findUnique({ where: { id }, select: { status: true, orderNumber: true } });
      if (!order) throw notFound('Order not found.');
      throw new AppError(
        409,
        'INVALID_STATUS_TRANSITION',
        `Order #${order.orderNumber} cannot move from ${order.status} to ${nextStatus}.`,
      );
    }

    // The conditional update above succeeds exactly once per order, so stock is restored exactly once.
    if (nextStatus === OrderStatus.CANCELLED) await restoreStock(tx, id);

    return tx.order.findUniqueOrThrow({ where: { id }, include: orderInclude });
  });
}

/** Every status from which staff may move an order to `target`. */
function statusesLeadingTo(target: OrderStatus): OrderStatus[] {
  return Object.values(OrderStatus).filter((from) => ALLOWED_TRANSITIONS[from].includes(target));
}

function visibleTo(user: AuthUser): Prisma.OrderWhereInput {
  return user.role === Role.STAFF ? {} : { userId: user.id };
}

/**
 * Snapshots each requested item's current name and price. Every refusal names the item (or, when the
 * item is gone, identifies it by id) so the client can point at the exact cart line.
 * Items arrive already merged by the schema, so the quantity cap applies to the real total per item.
 */
function priceLines(requested: CreateOrderInput['items'], byId: Map<string, MenuItem>): OrderLine[] {
  return requested.map(({ menuItemId, quantity }) => {
    const item = byId.get(menuItemId);
    if (!item) {
      throw new AppError(400, 'ITEM_NOT_FOUND', 'One of the items is no longer on the menu.', { menuItemId, available: 0 });
    }
    if (!item.isAvailable) {
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
    return { menuItemId, name: item.name, unitPrice: item.price, quantity, lineTotal: item.price * quantity };
  });
}

/**
 * Takes each line's quantity out of its item's stock, but only if that much is still there.
 * The conditional updateMany is atomic, so two customers can never both get the last one;
 * the loser is told exactly which item and how many are left (or that it just sold out).
 */
async function reserveStock(tx: Db, lines: OrderLine[], byId: Map<string, MenuItem>): Promise<void> {
  for (const { menuItemId, name, quantity } of lines) {
    if (byId.get(menuItemId)?.stockQuantity === null) continue; // not stock-tracked

    const { count } = await tx.menuItem.updateMany({
      where: { id: menuItemId, stockQuantity: { gte: quantity } },
      data: { stockQuantity: { decrement: quantity } },
    });
    if (count > 0) continue;

    const current = await tx.menuItem.findUnique({ where: { id: menuItemId }, select: { stockQuantity: true } });
    if (current?.stockQuantity === null) continue; // tracking was switched off meanwhile: nothing to reserve
    throw insufficientStock(menuItemId, name, current?.stockQuantity ?? 0);
  }
}

/** Puts a cancelled order's items back on the shelf. Untracked items (stock null) are left alone. */
async function restoreStock(tx: Db, orderId: string): Promise<void> {
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { menuItemId: true, quantity: true } });
  for (const { menuItemId, quantity } of items) {
    await tx.menuItem.updateMany({
      where: { id: menuItemId, stockQuantity: { not: null } },
      data: { stockQuantity: { increment: quantity } },
    });
  }
}

async function lookupUserName(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  return user.name;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}
