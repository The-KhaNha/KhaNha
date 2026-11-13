/** ADMIN is the site-wide developer role (/admin), not a restaurant role. */
export type Role = 'CUSTOMER' | 'STAFF' | 'ADMIN';
export type OrderStatus = 'PLACED' | 'PREPARING' | 'READY' | 'COLLECTED' | 'CANCELLED';
export type PaymentStatus = 'PENDING' | 'PAID';
export type ActorType = 'USER' | 'WORKER' | 'RECONCILER' | 'WEBHOOK' | 'SCHEDULER' | 'SYSTEM';
/** A role at one store (P2.2); the brand's owner is not a membership. */
export type StoreRole = 'MANAGER' | 'STAFF';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  createdAt: string; // ISO
  /** The stores this account works at. */
  memberships: {
    storeId: string;
    storeSlug: string;
    storeName: string;
    role: StoreRole;
    /** Whether the store lets its STAFF change stock. Optional: a profile saved before the field lacks it. */
    staffCanEditStock?: boolean;
  }[];
  /** The brands this account owns: OWNER of every store of each. */
  ownedBrands: { id: string; name: string; slug: string }[];
}

/** What a customer sees of a store's hours. `isOpen` is true for OPEN and CLOSING_SOON. */
export type OpenStateName = 'OPEN' | 'CLOSING_SOON' | 'CLOSED' | 'PAUSED' | 'UNAVAILABLE';

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
  openState: OpenStateName;
  /** The next change of state: the closing time while open, the next opening while closed; null when unknown. */
  nextChangeAt: string | null;
  /** Ready to show: "Closes at 9:00 PM", "Opens tomorrow at 8:00 AM", "Closed for Diwali". */
  openLabel: string | null;
  prepTimeMinMinutes: number;
  prepTimeMaxMinutes: number;
}

export type StoreSummary = Pick<
  Store,
  | 'id'
  | 'slug'
  | 'name'
  | 'tagline'
  | 'imageUrl'
  | 'area'
  | 'brand'
  | 'isOpen'
  | 'openState'
  | 'nextChangeAt'
  | 'openLabel'
>;

export type StoreStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

/** A store as its brand's owner and managers edit it (P3.1): any status, with its contact phone. */
export interface ManagedStore {
  id: string;
  slug: string;
  name: string;
  status: StoreStatus;
  isTemplate: boolean;
  area: string | null;
  address: string | null;
  contactPhone: string | null;
  tagline: string;
  description: string;
  imageUrl: string | null;
  createdAt: string;
}

/** What a branch still lacks before it can be published; empty: ready. */
export type PublishMissing = 'address' | 'hours' | 'menu';

/** GET /api/stores/:storeId/manage: the store at any status, its brand and its go-live checklist. */
export interface ManageStoreResponse {
  store: ManagedStore;
  brand: { id: string; name: string; slug: string };
  missing: PublishMissing[];
}

/** One brand of GET /api/brands/mine: its branches (every status) and its template. */
export interface MyBrand {
  id: string;
  name: string;
  slug: string;
  template: ManagedStore | null;
  stores: ManagedStore[];
}

/** One weekly interval of GET /api/stores/:storeRef/hours; `HH:MM`, `closesAt` before `opensAt` runs past midnight. */
export interface StoreHours {
  /** ISO weekday: 1 = Monday ... 7 = Sunday. */
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
}

export interface ScheduleException {
  id: string;
  startsOn: string;
  endsOn: string;
  kind: 'CLOSED' | 'SPECIAL_HOURS';
  opensAt: string | null;
  closesAt: string | null;
  label: string;
}

/** GET /api/stores/:storeRef/hours: the week, and the exceptions from today (store time) on. */
export interface StoreScheduleResponse {
  timezone: string;
  hours: StoreHours[];
  exceptions: ScheduleException[];
}

export interface MenuItem {
  id: string;
  category: string;
  name: string;
  description: string;
  price: number; // whole rupees
  /** null: no photo yet (an item made in the editor before its upload). */
  imageUrl: string | null;
  /**
   * null: not marked. Optional because a menu persisted before the field existed (fp_cache) lacks it; read it as
   * `item.diet ?? null`.
   */
  diet?: Diet | null;
  /** Effective availability: false when the shop switched the item off OR its tracked stock ran out. */
  isAvailable: boolean;
  isPopular: boolean;
  sortOrder: number;
  /** Units left when the item tracks stock; null = not tracked (only the per-order cap applies). */
  stockQuantity: number | null;
}

export type Diet = 'VEG' | 'NON_VEG' | 'EGG';

/** An item in the menu editor (GET /api/stores/:storeId/menu-items): archived ones too, with the raw switch. */
export interface ManagedMenuItem extends MenuItem {
  /** The switch alone; `isAvailable` also counts stock. */
  isEnabled: boolean;
  archivedAt: string | null;
  /** The template item this one was copied from (lineage); null for a branch's own. Optional: older answers lack it. */
  templateItemId?: string | null;
}

export interface MenuCategory {
  name: string;
  items: MenuItem[];
}

export interface MenuResponse {
  /**
   * The store's cart limits, handed to the cart by useMenu; optional because a menu persisted by an older build lacks
   * it (the cart then keeps config/fallbacks.json `storeDefaults`).
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
  store: { id: string; name: string; slug: string };
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
  kind?: 'rateLimit' | 'storeClosed' | 'storePaused' | 'storeNotReady';
  /** STORE_CLOSED: when the store next opens, when known. */
  nextChangeAt?: string;
  /** STORE_PAUSED: when the pause ends, or null when it lasts until someone resumes. */
  pausedUntil?: string | null;
  /** STORE_NOT_READY: what a store still needs before it can be published: 'address', 'hours', 'menu'. */
  missing?: string[];
  /** RATE_LIMITED: seconds until the window resets, the same number as the Retry-After header. */
  retryAfterSeconds?: number;
}

export interface ApiErrorEnvelope {
  error: { code: string; message: string; details?: ApiErrorDetails };
}

/** A store's own limits (GET/PATCH /api/stores/:storeId/settings), edited by its manager or owner. */
/** One person on a store's team (GET /api/stores/:storeId/members). */
export interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: StoreRole;
  joinedAt: string;
}

/** An open invite; one past `expiresAt` can no longer be accepted. */
export interface Invite {
  id: string;
  email: string;
  role: StoreRole;
  expiresAt: string;
  createdAt: string;
}

export interface StoreSettings {
  maxQuantityPerItem: number;
  lowStockThreshold: number;
  staffOrderListLimit: number;
  /** Minutes before closing at which the store stops taking orders; 0 = until it closes. */
  lastOrderMinutesBeforeClose: number;
  /** Whether STAFF may change stock here (P3.5); managers and the owner always may. */
  staffCanEditStock: boolean;
}

/** GET /api/stores/:storeId/stock: the live items and the store's low-stock threshold. */
export interface StockList {
  items: ManagedMenuItem[];
  lowStockThreshold: number;
}

/** One hand-made stock change (GET /api/stores/:storeId/stock-movements). Sales are not movements. */
export interface StockMovement {
  id: number;
  menuItemId: string;
  /** Units added (negative: removed); null when tracking started or stopped. */
  delta: number | null;
  /** Stock after the change; null: no longer tracked. */
  resultingQuantity: number | null;
  reason: 'MANUAL_SET' | 'MANUAL_ADJUST' | 'WASTE';
  /** Who made it; null for a system change or a deleted account. */
  actor: { id: string; name: string } | null;
  createdAt: string;
}

/** Site-wide limits edited on the admin dashboard. */
export interface SiteSettings {
  customerOrderHistoryLimit: number;
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
  /** The store the cart belongs to; without it the API picks the one active store. */
  storeId?: string;
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
