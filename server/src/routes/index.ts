import { Router } from 'express';
import { getHealth, getReady } from '../controllers/health.controller';
import { clientVersionGate } from '../middleware/clientVersion';
import { adminRouter } from './admin.routes';
import { authRouter } from './auth.routes';
import { menuRouter } from './menu.routes';
import { orderRouter } from './order.routes';
import { storeRouter } from './store.routes';

export const apiRouter = Router();

// Probes first: they must answer whatever the middleware mounted after them decides.
apiRouter.get('/health', getHealth);
apiRouter.get('/ready', getReady);

// Everything below answers 426 to a client older than site_settings.min_client_version. The exemptions are the routes
// above, by mount order, not a path list. No OPTIONS case: cors() answers preflights before the router, and the
// same-origin client sends none.
apiRouter.use(clientVersionGate);

apiRouter.use('/auth', authRouter);
apiRouter.use('/store', storeRouter);
apiRouter.use('/menu', menuRouter);
apiRouter.use('/orders', orderRouter);
apiRouter.use('/admin', adminRouter);
