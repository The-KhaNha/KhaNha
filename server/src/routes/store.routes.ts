import { Router } from 'express';
import * as orders from '../controllers/order.controller';
import * as store from '../controllers/store.controller';
import { requireAuth, requireStore } from '../middleware/auth';
import { writeLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { listOrdersQuerySchema, updateOrderStatusSchema } from '../schemas/order.schema';
import { storeListQuerySchema, storeRefParamsSchema } from '../schemas/store.schema';

export const storeRouter = Router();

storeRouter.get('/', store.getStore);

export const storesRouter = Router();

storesRouter.get('/', validate(storeListQuerySchema, 'query'), store.listStores);
storesRouter.get('/:storeRef', validate(storeRefParamsSchema, 'params'), store.getStoreByRef);
storesRouter.get('/:storeRef/menu', validate(storeRefParamsSchema, 'params'), store.getStoreMenu);

// Store-scoped staff routes (P2.3): requireStore admits the caller by capability (domain/permissions.ts).
storesRouter.get(
  '/:storeId/orders',
  requireAuth,
  requireStore('orders.view'),
  validate(listOrdersQuerySchema, 'query'),
  orders.listStoreOrders,
);
storesRouter.patch(
  '/:storeId/orders/:orderId/status',
  requireAuth,
  requireStore('orders.transition'),
  writeLimiter,
  validate(updateOrderStatusSchema),
  orders.updateStoreOrderStatus,
);
