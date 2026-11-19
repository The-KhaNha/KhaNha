import { Router } from 'express';
import { setFakeGatewayOutcome, showFakeGatewayPage } from '../controllers/fakeGateway.controller';
import { validate } from '../middleware/validate';
import { fakeGatewayOutcomeSchema, fakeGatewayPageSchema } from '../schemas/fakeGateway.schema';
import { env } from '../utils/env';

/**
 * The fake provider's payment page (P5.1). It exists only while PAYMENT_PROVIDER is `fake`, which production refuses,
 * and is read on every request (a test switches it); otherwise these paths fall through to the 404.
 */
export const fakeGatewayRouter = Router();

fakeGatewayRouter.use((_req, _res, next) =>
  next(env.PAYMENT_PROVIDER === 'fake' ? undefined : 'router'),
);
fakeGatewayRouter.get(
  '/:gatewayOrderId',
  validate(fakeGatewayPageSchema, 'params'),
  showFakeGatewayPage,
);
fakeGatewayRouter.post(
  '/:gatewayOrderId/:outcome',
  validate(fakeGatewayOutcomeSchema, 'params'),
  setFakeGatewayOutcome,
);
