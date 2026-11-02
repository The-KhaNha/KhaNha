import { Router } from 'express';
import { getConfig } from '../controllers/config.controller';
import { getHealth, getReady } from '../controllers/health.controller';
import { reportClientErrors } from '../controllers/clientErrors.controller';
import { clientVersionGate } from '../middleware/clientVersion';
import { clientErrorLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { clientErrorsSchema } from '../schemas/clientErrors.schema';
import { adminRouter } from './admin.routes';
import { authRouter } from './auth.routes';
import { menuRouter } from './menu.routes';
import { orderRouter } from './order.routes';
import { storeRouter } from './store.routes';

export const apiRouter = Router();

// Probes first: they must answer whatever the middleware mounted after them decides.
apiRouter.get('/health', getHealth);
apiRouter.get('/ready', getReady);
// Before the gate too: an outdated client must still learn the minimum version it has to reach.
apiRouter.get('/config', getConfig);
// Before the gate and without requireAuth: a stale tab's errors are the ones worth seeing, and errors happen before
// sign-in too.
apiRouter.post(
  '/client-errors',
  clientErrorLimiter,
  validate(clientErrorsSchema),
  reportClientErrors,
);

// Everything below answers 426 to a client older than site_settings.min_client_version. The exemptions are the routes
// above, by mount order, not a path list. No OPTIONS case: cors() answers preflights before the router, and the
// same-origin client sends none.
apiRouter.use(clientVersionGate);

apiRouter.use('/auth', authRouter);
apiRouter.use('/store', storeRouter);
apiRouter.use('/menu', menuRouter);
apiRouter.use('/orders', orderRouter);
apiRouter.use('/admin', adminRouter);
