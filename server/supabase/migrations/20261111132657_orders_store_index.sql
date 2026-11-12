-- P2.3: the store board reads one store's orders by status, newest or oldest first (GET /api/stores/:storeId/orders,
-- order.service listStoreOrders). The (status, created_at) index served the board when there was one store.
create index orders_store_id_status_created_at_idx on public.orders (store_id, status, created_at desc);
