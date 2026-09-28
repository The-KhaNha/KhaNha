// Response shapes shared with the client. Keep these in sync with the API contract.
import type { OrderStatus, PaymentStatus, Role } from './enums';

export interface UserDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  createdAt: string;
}

export interface StoreDto {
  id: string;
  name: string;
  tagline: string;
  description: string;
  imageUrl: string | null;
  isOpen: boolean;
  prepTimeMinMinutes: number;
  prepTimeMaxMinutes: number;
}

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
  /** Current photo of the menu item, so order screens need no menu lookup for thumbnails. */
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
  store: { id: string; name: string };
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
}
