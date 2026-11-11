/** ADMIN is the site-wide developer role (/admin), not a restaurant role. */
export type Role = 'CUSTOMER' | 'STAFF' | 'ADMIN';
export type OrderStatus = 'PLACED' | 'PREPARING' | 'READY' | 'COLLECTED' | 'CANCELLED';
export type PaymentStatus = 'PENDING' | 'PAID';
export type ActorType = 'USER' | 'WORKER' | 'RECONCILER' | 'WEBHOOK' | 'SCHEDULER' | 'SYSTEM';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  createdAt: string; // ISO
}

export interface Store {
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

export type StoreSummary = Pick<
  Store,
  'id' | 'slug' | 'name' | 'tagline' | 'imageUrl' | 'area' | 'brand' | 'isOpen'
>;

export interface MenuItem {
  id: string;
  category: string;
  name: string;
  description: string;
  price: number; // whole rupees
  imageUrl: string;
  /** Effective availability: false when the shop switched the item off OR its tracked stock ran out. */
  isAvailable: boolean;
  isPopular: boolean;
  sortOrder: number;
  /** Units left when the item tracks stock; null = not tracked (only the per-order cap applies). */
  stockQuantity: number | null;
}

export interface MenuCategory {
  name: string;
  items: MenuItem[];
}

export interface MenuResponse {
  /**
   * Cart rules from the server. The cart still uses its own copies in features/cart/cartRules.ts until P2.3 makes them
   * per store; optional because a menu persisted by an older build lacks it.
   */
  rules?: { maxQuantityPerItem: number; lowStockThreshold: number };
  store: Store;
  popular: MenuItem[];
  categories: MenuCategory[];
}

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  /** Photo of the menu item. Optional so orders served before the API added it still render (cream placeholder). */
  imageUrl?: string | null;
}

export interface Order {
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
  store: { id: string; name: string };
  items: OrderItem[];
}

/** Sent with errors about ONE cart line (INSUFFICIENT_STOCK, ITEM_UNAVAILABLE, ITEM_NOT_FOUND) so the UI can point at it. */
export interface ApiErrorDetails {
  menuItemId?: string;
  name?: string;
  /** How many can still be ordered; 0 = sold out, unavailable or gone from the menu. */
  available?: number;
  /** VALIDATION_ERROR, EMAIL_TAKEN: the request field at fault, for a form to show the message on it. */
  field?: string;
  /** IDEMPOTENCY_KEY_REUSED: the order the earlier attempt already placed. */
  orderId?: string;
  orderNumber?: number;
  /** Shapes added since P1 carry a `kind`; the ones above predate it and are told apart by `code`. */
  kind?: 'rateLimit';
  /** RATE_LIMITED: seconds until the window resets, the same number as the Retry-After header. */
  retryAfterSeconds?: number;
}

export interface ApiErrorEnvelope {
  error: { code: string; message: string; details?: ApiErrorDetails };
}

/** Site-wide limits edited on the admin dashboard. */
export interface SiteSettings {
  customerOrderHistoryLimit: number;
  staffOrderListLimit: number;
  /** Most lines one order may have. */
  maxLinesPerOrder: number;
  /** Poll intervals in ms: one order's page, the customer's order list, the staff board. */
  orderPollMs: number;
  ordersPollMs: number;
  staffBoardPollMs: number;
  /** The share of page loads (0–100) whose errors the client reports. */
  clientErrorSamplePercent: number;
  /** The oldest client version the API serves; older clients get 426 CLIENT_OUTDATED. */
  minClientVersion: string;
  updatedAt: string;
}

export interface CreateOrderInput {
  /** `expectedUnitPrice`: the rupee price the cart shows; a different current price is 409 PRICE_CHANGED. */
  items: { menuItemId: string; quantity: number; expectedUnitPrice?: number }[];
  customerName: string;
  customerPhone?: string;
  note?: string;
  /** One UUID per checkout attempt, resent on retry: the server returns the order it already placed for it. */
  idempotencyKey?: string;
}

/** GET /api/config (server ConfigDto). Until it loads, config/fallbacks.json stands in (features/config/useConfig). */
export interface Config {
  serverVersion: string;
  minClientVersion: string;
  features: Record<string, boolean>;
  payment: { provider: string; publicKey: string | null } | null;
  limits: { maxLinesPerOrder: number };
  /** Poll intervals in ms: one order's page, the customer's order list, the staff board. */
  polling: { orderMs: number; ordersMs: number; staffBoardMs: number };
  session: { idleDays: number };
  /** The share of page loads (0–100) that report their errors to POST /api/client-errors. */
  clientErrors: { samplePercent: number };
}

/** One audit_log row (server AuditEntryDto). No screen reads it until the admin audit view (P7.4). */
export interface AuditEntry {
  id: number;
  occurredAt: string;
  actorType: ActorType;
  actorId: string | null;
  actorRole: string | null;
  storeId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  changes: Record<string, [unknown, unknown]> | null;
  reason: string | null;
  requestId: string | null;
}

/** GET /api/admin/audit (server AuditPageDto). */
export interface AuditPage {
  entries: AuditEntry[];
  nextCursor: number | null;
}

/** One feature_flags row (server FeatureFlagDto). No screen reads it until the admin flags page (P7.4). */
export interface FeatureFlag {
  key: string;
  description: string;
  enabled: boolean;
  clientVisible: boolean;
  rules: { storeIds?: string[]; roles?: Role[]; percent?: number };
  updatedAt: string;
  updatedBy: string | null;
}
