export type Role = 'CUSTOMER' | 'STAFF';
export type OrderStatus = 'PLACED' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED';
export type PaymentStatus = 'PENDING' | 'PAID';

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
  name: string;
  tagline: string;
  description: string;
  imageUrl: string | null;
  isOpen: boolean;
  prepTimeMinMinutes: number;
  prepTimeMaxMinutes: number;
}

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
}

export interface ApiErrorEnvelope {
  error: { code: string; message: string; details?: ApiErrorDetails };
}

export interface CreateOrderInput {
  items: { menuItemId: string; quantity: number }[];
  customerName: string;
  customerPhone?: string;
  note?: string;
}
