import type { CreateOrderInput, Order, OrderStatus } from '../types/api';
import { request } from './api';

export async function createOrder(input: CreateOrderInput): Promise<Order> {
  const { order } = await request<{ order: Order }>('/orders', { method: 'POST', body: input });
  return order;
}

export async function fetchOrders(status?: OrderStatus): Promise<Order[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const { orders } = await request<{ orders: Order[] }>(`/orders${query}`);
  return orders;
}

export async function fetchOrder(id: string): Promise<Order> {
  const { order } = await request<{ order: Order }>(`/orders/${encodeURIComponent(id)}`);
  return order;
}

const storeOrders = (storeId: string, tail = '') =>
  `/stores/${encodeURIComponent(storeId)}/orders${tail}`;

/** The order board of one store (`orders.view`). */
export async function fetchStoreOrders(storeId: string): Promise<Order[]> {
  const { orders } = await request<{ orders: Order[] }>(storeOrders(storeId));
  return orders;
}

export async function updateOrderStatus(
  storeId: string,
  id: string,
  status: OrderStatus,
): Promise<Order> {
  const { order } = await request<{ order: Order }>(
    storeOrders(storeId, `/${encodeURIComponent(id)}/status`),
    {
      method: 'PATCH',
      body: { status },
    },
  );
  return order;
}
