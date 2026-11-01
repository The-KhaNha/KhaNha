import type { Request, RequestHandler } from 'express';
import { currentUser } from '../middleware/auth';
import type {
  CreateOrderInput,
  ListOrdersQuery,
  UpdateOrderStatusInput,
} from '../schemas/order.schema';
import * as orderService from '../services/order.service';
import type { RequestContext } from '../types/auth';
import type { BodyHandler, QueryHandler } from '../types/http';
import { toOrderDto } from '../utils/serializers';

type OrderParams = { id: string };

/** Who is asking, and which request: each order write records them with the event it emits. */
function requestContext(req: Request): RequestContext {
  const { id, role } = currentUser(req);
  return { actor: { type: 'USER', id, role }, requestId: String(req.id) };
}

export const createOrder: BodyHandler<CreateOrderInput> = async (req, res) => {
  const placed = await orderService.createOrder(currentUser(req), req.body, requestContext(req));
  const order = toOrderDto(placed.order);
  req.log.info(
    {
      orderId: order.id,
      orderNumber: order.orderNumber,
      lines: order.items.length,
      total: order.total,
    },
    // A replay is the same order answered again (a retried request): the same shape, so the client's one path
    // handles both, but a distinct message so a burst of them shows up in the logs.
    placed.replayed ? 'Order placement replayed' : 'Order placed',
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
  const { order: updated, repeated } = await orderService.updateOrderStatus(
    req.params.id,
    req.body.status,
    requestContext(req),
  );
  const order = toOrderDto(updated);
  req.log.info(
    {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      by: currentUser(req).id,
    },
    // A repeat answers the same 200 (a retried request, a second device), but changed nothing: told apart in the logs,
    // like a replayed placement.
    repeated ? 'Order status repeated' : 'Order status changed',
  );
  res.json({ order });
};
