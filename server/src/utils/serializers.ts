import type { MenuItem, Prisma, Store, User } from '@prisma/client';
import type { MenuItemDto, OrderDto, OrderItemDto, StoreDto, UserDto } from '../types/api';

/**
 * Every order endpoint returns the order with its items and a minimal store reference.
 * Each item also carries its menu item's current photo, so the client never needs the whole menu for thumbnails.
 */
export const orderInclude = {
  items: { orderBy: { id: 'asc' }, include: { menuItem: { select: { imageUrl: true } } } },
  store: { select: { id: true, name: true } },
} satisfies Prisma.OrderInclude;

export type OrderWithDetails = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

type OrderItemWithImage = OrderWithDetails['items'][number];

/** Never exposes passwordHash. */
export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toStoreDto(store: Store): StoreDto {
  return {
    id: store.id,
    name: store.name,
    tagline: store.tagline,
    description: store.description,
    imageUrl: store.imageUrl,
    isOpen: store.isOpen,
    prepTimeMinMinutes: store.prepTimeMinMinutes,
    prepTimeMaxMinutes: store.prepTimeMaxMinutes,
  };
}

/** An item can be ordered when it is switched on and, if it tracks stock, has some left. */
export function isPurchasable(item: Pick<MenuItem, 'isAvailable' | 'stockQuantity'>): boolean {
  return item.isAvailable && (item.stockQuantity === null || item.stockQuantity > 0);
}

export function toMenuItemDto(item: MenuItem): MenuItemDto {
  return {
    id: item.id,
    category: item.category,
    name: item.name,
    description: item.description,
    price: item.price,
    imageUrl: item.imageUrl,
    isAvailable: isPurchasable(item),
    isPopular: item.isPopular,
    sortOrder: item.sortOrder,
    stockQuantity: item.stockQuantity,
  };
}

function toOrderItemDto(item: OrderItemWithImage): OrderItemDto {
  return {
    id: item.id,
    menuItemId: item.menuItemId,
    name: item.name,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    lineTotal: item.lineTotal,
    imageUrl: item.menuItem.imageUrl,
  };
}

export function toOrderDto(order: OrderWithDetails): OrderDto {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    total: order.total,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    note: order.note,
    estimatedReadyAt: order.estimatedReadyAt.toISOString(),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    store: { id: order.store.id, name: order.store.name },
    items: order.items.map(toOrderItemDto),
  };
}
