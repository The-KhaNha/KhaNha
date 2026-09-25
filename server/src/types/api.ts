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
  store: StoreDto;
  popular: MenuItemDto[];
  categories: MenuCategoryDto[];
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

export interface AuthResponse {
  user: UserDto;
  token: string;
}
