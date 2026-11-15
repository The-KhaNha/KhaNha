import { Router } from 'express';
import * as brand from '../controllers/brand.controller';
import { requireAuth } from '../middleware/auth';
import { writeLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { pushTemplateSchema } from '../schemas/menuItem.schema';
import { createStoreSchema } from '../schemas/store.schema';

export const brandRouter = Router();

// A brand's owner opens branches (P3.1, D6); brands themselves are still made by the seed or in SQL until P7.4.
brandRouter.get('/mine', requireAuth, brand.listMyBrands);
brandRouter.post(
  '/:brandId/stores',
  requireAuth,
  writeLimiter,
  validate(createStoreSchema),
  brand.createStore,
);
// The owner pushes template items to branches (P3.1, D2); the service admits only the brand's owner (else 404).
brandRouter.post(
  '/:brandId/template/push',
  requireAuth,
  writeLimiter,
  validate(pushTemplateSchema),
  brand.pushTemplate,
);
