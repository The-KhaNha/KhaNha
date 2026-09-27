import type { QueryData } from '@supabase/supabase-js';
import type { Tables } from '../types/database';
import type {
  MenuItemDto,
  OrderDto,
  OrderItemDto,
  SiteSettingsDto,
  StoreDto,
  UserDto,
} from '../types/api';
import { supabaseAdmin } from './supabase';

/**
 * Every order endpoint returns the order with its lines and a minimal store reference.
 * Each line also carries its menu item's current photo, so the client never needs the whole menu for thumbnails.
 * Callers add their filters; lines always come back in cart order.
 */
export function selectOrders() {
  return supabaseAdmin
    .from('orders')
    .select(
      `id, order_number, status, payment_status, total, customer_name, customer_phone, note,
       estimated_ready_at, created_at, updated_at,
       stores (id, name),
       order_items (id, line_number, menu_item_id, name, unit_price, quantity, line_total, menu_items (image_url))`,
    )
    .order('line_number', { referencedTable: 'order_items' });
}

export type OrderWithDetails = QueryData<ReturnType<typeof selectOrders>>[number];

type OrderItemWithImage = OrderWithDetails['order_items'][number];

/** Postgres returns timestamps as "2026-09-25 10:00:00.123+00"-style strings; the API always sends ISO 8601. */
const toIso = (timestamp: string): string => new Date(timestamp).toISOString();

export function toUserDto(profile: Tables<'profiles'>): UserDto {
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    phone: profile.phone,
    role: profile.role,
    createdAt: toIso(profile.created_at),
  };
}

export function toSiteSettingsDto(settings: Tables<'site_settings'>): SiteSettingsDto {
  return {
    customerOrderHistoryLimit: settings.customer_order_history_limit,
    staffOrderListLimit: settings.staff_order_list_limit,
    updatedAt: settings.updated_at,
  };
}

export function toStoreDto(store: Tables<'stores'>): StoreDto {
  return {
    id: store.id,
    name: store.name,
    tagline: store.tagline,
    description: store.description,
    imageUrl: store.image_url,
    isOpen: store.is_open,
    prepTimeMinMinutes: store.prep_time_min_minutes,
    prepTimeMaxMinutes: store.prep_time_max_minutes,
  };
}

/** An item can be ordered when it is switched on and, if it tracks stock, has some left. */
export function isPurchasable(
  item: Pick<Tables<'menu_items'>, 'is_available' | 'stock_quantity'>,
): boolean {
  return item.is_available && (item.stock_quantity === null || item.stock_quantity > 0);
}

export function toMenuItemDto(item: Tables<'menu_items'>): MenuItemDto {
  return {
    id: item.id,
    category: item.category,
    name: item.name,
    description: item.description,
    price: item.price,
    imageUrl: item.image_url,
    isAvailable: isPurchasable(item),
    isPopular: item.is_popular,
    sortOrder: item.sort_order,
    stockQuantity: item.stock_quantity,
  };
}

function toOrderItemDto(item: OrderItemWithImage): OrderItemDto {
  return {
    id: item.id,
    menuItemId: item.menu_item_id,
    name: item.name,
    unitPrice: item.unit_price,
    quantity: item.quantity,
    lineTotal: item.line_total,
    imageUrl: item.menu_items.image_url,
  };
}

export function toOrderDto(order: OrderWithDetails): OrderDto {
  return {
    id: order.id,
    orderNumber: order.order_number,
    status: order.status,
    paymentStatus: order.payment_status,
    total: order.total,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    note: order.note,
    estimatedReadyAt: toIso(order.estimated_ready_at),
    createdAt: toIso(order.created_at),
    updatedAt: toIso(order.updated_at),
    store: { id: order.stores.id, name: order.stores.name },
    items: order.order_items.map(toOrderItemDto),
  };
}
