// Response shapes shared with the client. Keep these in sync with the API contract.
import type { ActorType, OrderStatus, PaymentStatus, Role, StoreRole } from './enums';

export interface UserDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  createdAt: string;
  /** The stores this account works at (P2.2); the brand's owner has no rows here. */
  memberships: { storeId: string; storeSlug: string; storeName: string; role: StoreRole }[];
  /** The brands this account owns: OWNER of every store of each (ADR-001). */
  ownedBrands: { id: string; name: string; slug: string }[];
}

export interface StoreDto {
  id: string;
  slug: string;
  name: string;
  brand: { id: string; name: string; slug: string };
  area: string | null;
  address: string | null;
  tagline: string;
  description: string;
  imageUrl: string | null;
  isOpen: boolean;
  prepTimeMinMinutes: number;
  prepTimeMaxMinutes: number;
}

/** One row of GET /api/stores: what a store picker shows. */
export type StoreSummaryDto = Pick<
  StoreDto,
  'id' | 'slug' | 'name' | 'tagline' | 'imageUrl' | 'area' | 'brand' | 'isOpen'
>;

export interface MenuItemDto {
  id: string;
  category: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  /** Effective availability: false when the item is switched off OR its tracked stock has run out. */
  isAvailable: boolean;
  isPopular: boolean;
  sortOrder: number;
  /** Units left when the item tracks stock; null = not tracked (only the per-order cap applies). */
  stockQuantity: number | null;
}

export interface MenuCategoryDto {
  name: string;
  items: MenuItemDto[];
}

export interface MenuResponse {
  /** Cart rules: most of one item per order, and the stock at or below which the menu says "only N left". */
  rules: { maxQuantityPerItem: number; lowStockThreshold: number };
  store: StoreDto;
  popular: MenuItemDto[];
  categories: MenuCategoryDto[];
}

/** Site-wide limits edited on the admin dashboard (the site_settings row). */
export interface SiteSettingsDto {
  customerOrderHistoryLimit: number;
  staffOrderListLimit: number;
  /** Most lines one order may have (enforced by createOrder). */
  maxLinesPerOrder: number;
  /** Client poll intervals in ms: one order's page, the customer's order list, the staff board. */
  orderPollMs: number;
  ordersPollMs: number;
  staffBoardPollMs: number;
  /** The share of page loads (0–100) whose errors the client reports to POST /api/client-errors. */
  clientErrorSamplePercent: number;
  /** The oldest client version served; older clients get 426 CLIENT_OUTDATED. */
  minClientVersion: string;
  updatedAt: string;
}

export interface OrderItemDto {
  id: string;
  menuItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  /** The menu item's photo when the order was placed, so order screens need no menu lookup for thumbnails. */
  imageUrl: string;
}

export interface OrderDto {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  total: number;
  customerName: string;
  customerPhone: string | null;
  note: string | null;
  estimatedReadyAt: string;
  createdAt: string;
  updatedAt: string;
  /** The store's name when the order was placed; its slug is the live one, for a link to the store. */
  store: { id: string; name: string; slug: string };
  items: OrderItemDto[];
}

/** GET /api/config: what the client needs to run. The client's defaults are client/src/config/fallbacks.json. */
export interface ConfigDto {
  serverVersion: string;
  minClientVersion: string;
  /** Feature flags by name; empty until P1.7. */
  features: Record<string, boolean>;
  /** The payment provider's public details; null until P5. */
  payment: { provider: string; publicKey: string | null } | null;
  limits: { maxLinesPerOrder: number };
  /** Poll intervals in ms: one order's page, the customer's order list, the staff board. */
  polling: { orderMs: number; ordersMs: number; staffBoardMs: number };
  session: { idleDays: number };
  /** The share of page loads (0–100) that report their errors to POST /api/client-errors. */
  clientErrors: { samplePercent: number };
}

/** One audit_log row (GET /api/admin/audit): who changed what, when. */
export interface AuditEntryDto {
  id: number;
  occurredAt: string;
  actorType: ActorType;
  /** The profile id for a USER, null for system actors. */
  actorId: string | null;
  /** The actor's role when the change happened. */
  actorRole: string | null;
  storeId: string | null;
  /** 'order.status_changed', 'menu_item.changed', ... */
  action: string;
  entityType: string;
  entityId: string;
  /** The watched columns that changed, as { column: [old, new] }. */
  changes: Record<string, [unknown, unknown]> | null;
  reason: string | null;
  requestId: string | null;
}

/** GET /api/admin/audit: one page, newest first. Pass nextCursor back as `before`; null on the last page. */
export interface AuditPageDto {
  entries: AuditEntryDto[];
  nextCursor: number | null;
}

/** One feature_flags row (PATCH /api/admin/flags/:key). */
export interface FeatureFlagDto {
  key: string;
  description: string;
  enabled: boolean;
  /** Served to the client through GET /api/config (P1.7, PR 14). */
  clientVisible: boolean;
  /** Who gets it once enabled: each list narrows, `percent` is a stable share of signed-in users. */
  rules: { storeIds?: string[]; roles?: Role[]; percent?: number };
  updatedAt: string;
  /** The admin who last changed it; null for a migration or a deleted account. */
  updatedBy: string | null;
}
