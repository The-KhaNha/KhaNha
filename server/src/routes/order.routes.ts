import { Router } from 'express';
import * as orders from '../controllers/order.controller';
import { requireAuth } from '../middleware/auth';
import { writeLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { createOrderSchema, listOrdersQuerySchema } from '../schemas/order.schema';

export const orderRouter = Router();

orderRouter.use(requireAuth);

orderRouter.post('/', writeLimiter, validate(createOrderSchema), orders.createOrder);
orderRouter.get('/', validate(listOrdersQuerySchema, 'query'), orders.listOrders);
orderRouter.get('/:id', orders.getOrder);
