import type { QueryData } from '@supabase/supabase-js';
import type { Tables } from '../types/database';
import type {
  AuditEntryDto,
  FeatureFlagDto,
  MenuItemDto,
  OrderDto,
  OrderItemDto,
  SiteSettingsDto,
  StoreDto,
  UserDto,
} from '../types/api';
import { paiseToRupees } from './money';
import { supabaseAdmin } from './supabase';

/**
 * Every order endpoint returns the order with its lines and a minimal store reference.
 * The store's name and each line's photo are snapshots taken when the order was placed (place_order), so a later menu
 * or store edit never rewrites a past order, and the read needs no join beyond its own lines.
 * Amounts are read in paise and sent in rupees (utils/money.ts).
 * Callers add their filters; lines always come back in cart order.
 */
export function selectOrders() {
  return supabaseAdmin
    .from('orders')
    .select(
      `id, order_number, status, payment_status, total_paise, customer_name, customer_phone, note,
       estimated_ready_at, created_at, updated_at, store_id, store_name,
       order_items (id, line_number, menu_item_id, name, unit_price_paise, quantity, line_total_paise, image_url)`,
    )
    .order('line_number', { referencedTable: 'order_items' });
}

export type OrderWithDetails = QueryData<ReturnType<typeof selectOrders>>[number];

type OrderItemRow = OrderWithDetails['order_items'][number];

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
    maxLinesPerOrder: settings.max_lines_per_order,
    orderPollMs: settings.order_poll_ms,
    ordersPollMs: settings.orders_poll_ms,
    staffBoardPollMs: settings.staff_board_poll_ms,
    clientErrorSamplePercent: settings.client_error_sample_percent,
    minClientVersion: settings.min_client_version,
    updatedAt: settings.updated_at,
  };
}

/** A store with its brand's identity, which is all the public DTO shows of the brand. */
export type StoreWithBrand = Tables<'stores'> & {
  brand: Pick<Tables<'brands'>, 'id' | 'name' | 'slug'>;
};

export function toStoreDto(store: StoreWithBrand): StoreDto {
  return {
    id: store.id,
    slug: store.slug,
    name: store.name,
    brand: store.brand,
    area: store.area,
    address: store.address_line,
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
    price: paiseToRupees(item.price_paise),
    imageUrl: item.image_url,
    isAvailable: isPurchasable(item),
    isPopular: item.is_popular,
    sortOrder: item.sort_order,
    stockQuantity: item.stock_quantity,
  };
}

function toOrderItemDto(item: OrderItemRow): OrderItemDto {
  return {
    id: item.id,
    menuItemId: item.menu_item_id,
    name: item.name,
    unitPrice: paiseToRupees(item.unit_price_paise),
    quantity: item.quantity,
    lineTotal: paiseToRupees(item.line_total_paise),
    imageUrl: item.image_url,
  };
}

export function toOrderDto(order: OrderWithDetails): OrderDto {
  return {
    id: order.id,
    orderNumber: order.order_number,
    status: order.status,
    paymentStatus: order.payment_status,
    total: paiseToRupees(order.total_paise),
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    note: order.note,
    estimatedReadyAt: toIso(order.estimated_ready_at),
    createdAt: toIso(order.created_at),
    updatedAt: toIso(order.updated_at),
    store: { id: order.store_id, name: order.store_name },
    items: order.order_items.map(toOrderItemDto),
  };
}

export function toAuditEntryDto(entry: Tables<'audit_log'>): AuditEntryDto {
  return {
    id: entry.id,
    occurredAt: toIso(entry.occurred_at),
    actorType: entry.actor_type,
    actorId: entry.actor_id,
    actorRole: entry.actor_role,
    storeId: entry.store_id,
    action: entry.action,
    entityType: entry.entity_type,
    entityId: entry.entity_id,
    // audit_row_change() writes only { column: [old, new] }; the generated type is plain Json.
    changes: entry.changes as AuditEntryDto['changes'],
    reason: entry.reason,
    requestId: entry.request_id,
  };
}

export function toFeatureFlagDto(flag: Tables<'feature_flags'>): FeatureFlagDto {
  return {
    key: flag.key,
    description: flag.description,
    enabled: flag.enabled,
    clientVisible: flag.client_visible,
    // As stored: written through flagRulesSchema, but a hand edit may not parse, and the admin should see what is there.
    rules: flag.rules as FeatureFlagDto['rules'],
    updatedAt: toIso(flag.updated_at),
    updatedBy: flag.updated_by,
  };
}
