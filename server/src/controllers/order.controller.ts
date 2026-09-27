import type { RequestHandler } from 'express';
import { currentUser } from '../middleware/auth';
import type {
  CreateOrderInput,
  ListOrdersQuery,
  UpdateOrderStatusInput,
} from '../schemas/order.schema';
import * as orderService from '../services/order.service';
import type { BodyHandler, QueryHandler } from '../types/http';
import { toOrderDto } from '../utils/serializers';

type OrderParams = { id: string };

export const createOrder: BodyHandler<CreateOrderInput> = async (req, res) => {
  const order = toOrderDto(await orderService.createOrder(currentUser(req), req.body));
  req.log.info(
    {
      orderId: order.id,
      orderNumber: order.orderNumber,
      lines: order.items.length,
      total: order.total,
    },
    'Order placed',
  );
  res.status(201).json({ order });
};

export const listOrders: QueryHandler<ListOrdersQuery> = async (req, res) => {
  const orders = await orderService.listOrders(currentUser(req), req.query.status);
  res.json({ orders: orders.map(toOrderDto) });
};

export const getOrder: RequestHandler<OrderParams> = async (req, res) => {
  const order = await orderService.getOrder(currentUser(req), req.params.id);
  res.json({ order: toOrderDto(order) });
};

export const updateOrderStatus: BodyHandler<UpdateOrderStatusInput, OrderParams> = async (
  req,
  res,
) => {
  const order = toOrderDto(await orderService.updateOrderStatus(req.params.id, req.body.status));
  req.log.info(
    {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      by: currentUser(req).id,
    },
    'Order status changed',
  );
  res.json({ order });
};
