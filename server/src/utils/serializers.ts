import type { QueryData } from '@supabase/supabase-js';
import type { Tables } from '../types/database';
import type { StoreRole } from '../types/enums';
import type {
  AuditEntryDto,
  FeatureFlagDto,
  InviteDto,
  MemberDto,
  ManagedMenuItemDto,
  ManagedStoreDto,
  MediaUploadDto,
  MenuItemDto,
  OrderDto,
  OrderItemDto,
  SiteSettingsDto,
  StoreDto,
  StoreSettingsDto,
  StockMovementDto,
  StoreSummaryDto,
  UserDto,
} from '../types/api';
import { paiseToRupees } from './money';
import { supabaseAdmin } from './supabase';

/**
 * Every order endpoint returns the order with its lines and a minimal store reference.
 * The store's name and each line's photo are snapshots taken when the order was placed (place_order), so a later menu
 * or store edit never rewrites a past order. The store join brings its live slug, and its brand for the access check.
 * Amounts are read in paise and sent in rupees (utils/money.ts).
 * Callers add their filters; lines always come back in cart order.
 */
export function selectOrders() {
  return supabaseAdmin
    .from('orders')
    .select(
      `id, order_number, status, payment_status, total_paise, customer_name, customer_phone, note,
       estimated_ready_at, created_at, updated_at, user_id, store_id, store_name,
       store:stores!inner (slug, brand_id),
       order_items (id, line_number, menu_item_id, name, unit_price_paise, quantity, line_total_paise, image_url)`,
    )
    .order('line_number', { referencedTable: 'order_items' });
}

export type OrderWithDetails = QueryData<ReturnType<typeof selectOrders>>[number];

type OrderItemRow = OrderWithDetails['order_items'][number];

/** Postgres returns timestamps as "2026-09-25 10:00:00.123+00"-style strings; the API always sends ISO 8601. */
const toIso = (timestamp: string): string => new Date(timestamp).toISOString();

/** A profile with its store memberships and owned brands embedded (auth.service.getProfile). */
export type ProfileWithStanding = Tables<'profiles'> & {
  memberships: {
    role: StoreRole;
    store: { id: string; slug: string; name: string; staff_can_edit_stock: boolean };
  }[];
  brands: { id: string; name: string; slug: string }[];
};

export function toUserDto(profile: ProfileWithStanding): UserDto {
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    phone: profile.phone,
    role: profile.role,
    createdAt: toIso(profile.created_at),
    memberships: profile.memberships.map(({ role, store }) => ({
      storeId: store.id,
      storeSlug: store.slug,
      storeName: store.name,
      role,
      staffCanEditStock: store.staff_can_edit_stock,
    })),
    ownedBrands: profile.brands.map(({ id, name, slug }) => ({ id, name, slug })),
  };
}

/** A store's own limits: columns of its `stores` row (storeSettings.service). */
export type StoreSettings = Pick<
  Tables<'stores'>,
  | 'max_quantity_per_item'
  | 'low_stock_threshold'
  | 'staff_order_list_limit'
  | 'last_order_minutes_before_close'
  | 'staff_can_edit_stock'
>;

export function toStoreSettingsDto(settings: StoreSettings): StoreSettingsDto {
  return {
    maxQuantityPerItem: settings.max_quantity_per_item,
    lowStockThreshold: settings.low_stock_threshold,
    staffOrderListLimit: settings.staff_order_list_limit,
    lastOrderMinutesBeforeClose: settings.last_order_minutes_before_close,
    staffCanEditStock: settings.staff_can_edit_stock,
  };
}

/** A stock_movements row with its actor embedded (stock.service.listStockMovements). */
export type StockMovementRow = Pick<
  Tables<'stock_movements'>,
  'id' | 'menu_item_id' | 'delta' | 'resulting_quantity' | 'reason' | 'created_at'
> & { actor: Pick<Tables<'profiles'>, 'id' | 'name'> | null };

export function toStockMovementDto(row: StockMovementRow): StockMovementDto {
  return {
    id: row.id,
    menuItemId: row.menu_item_id,
    delta: row.delta,
    resultingQuantity: row.resulting_quantity,
    reason: row.reason,
    actor: row.actor ? { id: row.actor.id, name: row.actor.name } : null,
    createdAt: row.created_at,
  };
}

type MemberRow = Pick<Tables<'store_memberships'>, 'id' | 'role' | 'created_at'> & {
  user: Pick<Tables<'profiles'>, 'id' | 'name' | 'email'>;
};

export function toMemberDto(member: MemberRow): MemberDto {
  return {
    id: member.id,
    userId: member.user.id,
    name: member.user.name,
    email: member.user.email,
    role: member.role,
    joinedAt: toIso(member.created_at),
  };
}

export function toInviteDto(
  invite: Pick<Tables<'store_invites'>, 'id' | 'email' | 'role' | 'expires_at' | 'created_at'>,
): InviteDto {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    expiresAt: toIso(invite.expires_at),
    createdAt: toIso(invite.created_at),
  };
}

export function toSiteSettingsDto(settings: Tables<'site_settings'>): SiteSettingsDto {
  return {
    customerOrderHistoryLimit: settings.customer_order_history_limit,
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

/** The open-state fields of a store DTO (services/schedule.service.ts computes them). */
export type OpenFields = Pick<StoreDto, 'isOpen' | 'openState' | 'nextChangeAt' | 'openLabel'>;

export function toStoreDto(store: StoreWithBrand, open: OpenFields): StoreDto {
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
    ...open,
    prepTimeMinMinutes: store.prep_time_min_minutes,
    prepTimeMaxMinutes: store.prep_time_max_minutes,
  };
}

export function toManagedStoreDto(store: Tables<'stores'>): ManagedStoreDto {
  return {
    id: store.id,
    slug: store.slug,
    name: store.name,
    status: store.status,
    isTemplate: store.is_template,
    area: store.area,
    address: store.address_line,
    contactPhone: store.contact_phone,
    tagline: store.tagline,
    description: store.description,
    imageUrl: store.image_url,
    createdAt: toIso(store.created_at),
  };
}

export function toStoreSummaryDto(store: StoreWithBrand, open: OpenFields): StoreSummaryDto {
  return {
    id: store.id,
    slug: store.slug,
    name: store.name,
    tagline: store.tagline,
    imageUrl: store.image_url,
    area: store.area,
    brand: store.brand,
    ...open,
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
    diet: item.diet,
    isAvailable: isPurchasable(item),
    isPopular: item.is_popular,
    sortOrder: item.sort_order,
    stockQuantity: item.stock_quantity,
  };
}

export function toManagedMenuItemDto(item: Tables<'menu_items'>): ManagedMenuItemDto {
  return {
    ...toMenuItemDto(item),
    isEnabled: item.is_available,
    archivedAt: item.archived_at,
    templateItemId: item.template_item_id,
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
    store: { id: order.store_id, name: order.store_name, slug: order.store.slug },
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

/** A media_uploads row; `url` is the store's public path for its key (integrations/media). */
export function toMediaUploadDto(row: Tables<'media_uploads'>, url: string): MediaUploadDto {
  return {
    id: row.id,
    status: row.status,
    contentType: row.content_type,
    byteSize: row.byte_size,
    url,
    variants: row.variants,
    failure: row.failure,
    createdAt: toIso(row.created_at),
  };
}
