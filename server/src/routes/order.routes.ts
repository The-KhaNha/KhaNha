import { Router } from 'express';
import * as orders from '../controllers/order.controller';
import { requireAuth, requireStaff } from '../middleware/auth';
import { writeLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import {
  createOrderSchema,
  listOrdersQuerySchema,
  updateOrderStatusSchema,
} from '../schemas/order.schema';

export const orderRouter = Router();

orderRouter.use(requireAuth);

orderRouter.post('/', writeLimiter, validate(createOrderSchema), orders.createOrder);
orderRouter.get('/', validate(listOrdersQuerySchema, 'query'), orders.listOrders);
orderRouter.get('/:id', orders.getOrder);
orderRouter.patch(
  '/:id/status',
  requireStaff,
  writeLimiter,
  validate(updateOrderStatusSchema),
  orders.updateOrderStatus,
);
