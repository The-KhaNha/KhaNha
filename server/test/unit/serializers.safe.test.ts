import { describe, expect, it } from 'vitest';
import {
  isPurchasable,
  toMenuItemDto,
  toOrderDto,
  toStoreDto,
  toUserDto,
  type ProfileWithStanding,
  type OrderWithDetails,
  type StoreWithBrand,
} from '../../src/utils/serializers';
import type { Tables } from '../../src/types/database';

function profile(overrides: Partial<ProfileWithStanding> = {}): ProfileWithStanding {
  return {
    memberships: [],
    brands: [],
    id: 'user-1',
    name: 'Ann',
    email: 'ann@example.test',
    phone: '9876543210',
    role: 'CUSTOMER',
    created_at: '2026-09-25 10:00:00.123+00',
    ...overrides,
  };
}

function store(overrides: Partial<StoreWithBrand> = {}): StoreWithBrand {
  return {
    id: 'store-1',
    slug: 'campus-cafe',
    brand_id: 'brand-1',
    brand: { id: 'brand-1', name: 'Campus Cafe', slug: 'campus-cafe' },
    status: 'ACTIVE',
    timezone: 'Asia/Kolkata',
    area: 'Main Campus',
    address_line: null,
    contact_phone: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    name: 'Campus Cafe',
    tagline: 'Coffee • Snacks • Quick Bites',
    description: 'Quick bites, coffee and snacks.',
    image_url: '/images/cafe-cover.jpg',
    is_open: true,
    prep_time_min_minutes: 10,
    prep_time_max_minutes: 15,
    max_quantity_per_item: 10,
    low_stock_threshold: 5,
    staff_order_list_limit: 100,
    last_order_minutes_before_close: 0,
    ...overrides,
  };
}

function menuItem(overrides: Partial<Tables<'menu_items'>> = {}): Tables<'menu_items'> {
  return {
    id: 'item-1',
    store_id: 'store-1',
    category: 'Coffee',
    name: 'Cold Coffee',
    description: 'Creamy chilled coffee',
    price_paise: 12000,
    image_url: '/images/cold-coffee.jpg',
    is_available: true,
    is_popular: true,
    sort_order: 1,
    stock_quantity: null,
    ...overrides,
  };
}

function orderWithDetails(overrides: Partial<OrderWithDetails> = {}): OrderWithDetails {
  return {
    id: 'order-1',
    order_number: 1001,
    status: 'PLACED',
    payment_status: 'PAID',
    total_paise: 24000,
    customer_name: 'Ann',
    customer_phone: '9876543210',
    note: null,
    estimated_ready_at: '2026-09-25 10:15:00.000+00',
    created_at: '2026-09-25 10:00:00.000+00',
    updated_at: '2026-09-25 10:00:00.000+00',
    user_id: 'user-1',
    store_id: 'store-1',
    store_name: 'Campus Cafe',
    store: { slug: 'campus-cafe', brand_id: 'brand-1' },
    order_items: [
      {
        id: 'oi-1',
        line_number: 1,
        menu_item_id: 'item-1',
        name: 'Cold Coffee',
        unit_price_paise: 12000,
        quantity: 2,
        line_total_paise: 24000,
        image_url: '/images/cold-coffee.jpg',
      },
    ],
    ...overrides,
  } as OrderWithDetails;
}

describe('toUserDto', () => {
  it('maps a profile row to the DTO, converting the timestamp to ISO 8601', () => {
    expect(toUserDto(profile())).toEqual({
      id: 'user-1',
      name: 'Ann',
      email: 'ann@example.test',
      phone: '9876543210',
      role: 'CUSTOMER',
      createdAt: new Date('2026-09-25 10:00:00.123+00').toISOString(),
      memberships: [],
      ownedBrands: [],
    });
  });

  it('maps the embedded memberships and owned brands', () => {
    const dto = toUserDto(
      profile({
        memberships: [{ role: 'MANAGER', store: { id: 's-1', slug: 'north', name: 'North' } }],
        brands: [{ id: 'b-1', name: 'Brew', slug: 'brew' }],
      }),
    );
    expect(dto.memberships).toEqual([
      { storeId: 's-1', storeSlug: 'north', storeName: 'North', role: 'MANAGER' },
    ]);
    expect(dto.ownedBrands).toEqual([{ id: 'b-1', name: 'Brew', slug: 'brew' }]);
  });

  it('passes through a null phone', () => {
    expect(toUserDto(profile({ phone: null })).phone).toBeNull();
  });
});

describe('toStoreDto', () => {
  it('maps snake_case store fields to camelCase', () => {
    expect(toStoreDto(store())).toEqual({
      id: 'store-1',
      slug: 'campus-cafe',
      name: 'Campus Cafe',
      brand: { id: 'brand-1', name: 'Campus Cafe', slug: 'campus-cafe' },
      area: 'Main Campus',
      address: null,
      tagline: 'Coffee • Snacks • Quick Bites',
      description: 'Quick bites, coffee and snacks.',
      imageUrl: '/images/cafe-cover.jpg',
      isOpen: true,
      prepTimeMinMinutes: 10,
      prepTimeMaxMinutes: 15,
    });
  });

  it('passes through a null image', () => {
    expect(toStoreDto(store({ image_url: null })).imageUrl).toBeNull();
  });
});

describe('isPurchasable', () => {
  it('is false when switched off, regardless of stock', () => {
    expect(isPurchasable({ is_available: false, stock_quantity: null })).toBe(false);
    expect(isPurchasable({ is_available: false, stock_quantity: 5 })).toBe(false);
  });

  it('is true when available with untracked (null) stock', () => {
    expect(isPurchasable({ is_available: true, stock_quantity: null })).toBe(true);
  });

  it('is true only while tracked stock is above zero', () => {
    expect(isPurchasable({ is_available: true, stock_quantity: 1 })).toBe(true);
    expect(isPurchasable({ is_available: true, stock_quantity: 0 })).toBe(false);
  });
});

describe('toMenuItemDto', () => {
  it('maps fields and derives isAvailable from isPurchasable', () => {
    const dto = toMenuItemDto(menuItem({ is_available: true, stock_quantity: 0 }));
    expect(dto).toEqual({
      id: 'item-1',
      category: 'Coffee',
      name: 'Cold Coffee',
      description: 'Creamy chilled coffee',
      price: 120,
      imageUrl: '/images/cold-coffee.jpg',
      isAvailable: false,
      isPopular: true,
      sortOrder: 1,
      stockQuantity: 0,
    });
  });

  it('reports untracked stock as null', () => {
    expect(toMenuItemDto(menuItem()).stockQuantity).toBeNull();
  });
});

describe('toOrderDto', () => {
  it('maps order, store snapshot, and lines with their photo snapshot, converting every timestamp', () => {
    const dto = toOrderDto(orderWithDetails());
    expect(dto).toEqual({
      id: 'order-1',
      orderNumber: 1001,
      status: 'PLACED',
      paymentStatus: 'PAID',
      total: 240,
      customerName: 'Ann',
      customerPhone: '9876543210',
      note: null,
      estimatedReadyAt: new Date('2026-09-25 10:15:00.000+00').toISOString(),
      createdAt: new Date('2026-09-25 10:00:00.000+00').toISOString(),
      updatedAt: new Date('2026-09-25 10:00:00.000+00').toISOString(),
      store: { id: 'store-1', name: 'Campus Cafe', slug: 'campus-cafe' },
      items: [
        {
          id: 'oi-1',
          menuItemId: 'item-1',
          name: 'Cold Coffee',
          unitPrice: 120,
          quantity: 2,
          lineTotal: 240,
          imageUrl: '/images/cold-coffee.jpg',
        },
      ],
    });
  });

  it('passes through a null note and null customer phone', () => {
    const dto = toOrderDto(orderWithDetails({ note: null, customer_phone: null }));
    expect(dto.note).toBeNull();
    expect(dto.customerPhone).toBeNull();
  });

  it('keeps lines in the order returned by the query (cart order)', () => {
    const dto = toOrderDto(
      orderWithDetails({
        order_items: [
          {
            id: 'oi-2',
            line_number: 2,
            menu_item_id: 'item-2',
            name: 'Espresso',
            unit_price_paise: 9000,
            quantity: 1,
            line_total_paise: 9000,
            image_url: '/images/espresso.jpg',
          },
          {
            id: 'oi-1',
            line_number: 1,
            menu_item_id: 'item-1',
            name: 'Cold Coffee',
            unit_price_paise: 12000,
            quantity: 2,
            line_total_paise: 24000,
            image_url: '/images/cold-coffee.jpg',
          },
        ] as OrderWithDetails['order_items'],
      }),
    );
    expect(dto.items.map((item) => item.name)).toEqual(['Espresso', 'Cold Coffee']);
  });
});
