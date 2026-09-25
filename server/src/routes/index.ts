import { Router } from 'express';
import { authRouter } from './auth.routes';
import { menuRouter } from './menu.routes';
import { orderRouter } from './order.routes';
import { storeRouter } from './store.routes';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/store', storeRouter);
apiRouter.use('/menu', menuRouter);
apiRouter.use('/orders', orderRouter);
