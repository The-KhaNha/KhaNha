import { Router } from 'express';
import { getHealth, getReady } from '../controllers/health.controller';
import { adminRouter } from './admin.routes';
import { authRouter } from './auth.routes';
import { menuRouter } from './menu.routes';
import { orderRouter } from './order.routes';
import { storeRouter } from './store.routes';

export const apiRouter = Router();

// Probes first: they must answer whatever the middleware mounted after them decides.
apiRouter.get('/health', getHealth);
apiRouter.get('/ready', getReady);

apiRouter.use('/auth', authRouter);
apiRouter.use('/store', storeRouter);
apiRouter.use('/menu', menuRouter);
apiRouter.use('/orders', orderRouter);
apiRouter.use('/admin', adminRouter);
