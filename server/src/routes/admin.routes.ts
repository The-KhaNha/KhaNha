import { Router } from 'express';
import * as admin from '../controllers/admin.controller';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { writeLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import {
  auditQuerySchema,
  createBrandInviteSchema,
  createBrandSchema,
  updateFlagSchema,
  updateSettingsSchema,
} from '../schemas/admin.schema';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get('/settings', admin.getSettings);
adminRouter.patch('/settings', writeLimiter, validate(updateSettingsSchema), admin.updateSettings);
adminRouter.get('/audit', validate(auditQuerySchema, 'query'), admin.listAudit);
adminRouter.patch('/flags/:key', writeLimiter, validate(updateFlagSchema), admin.updateFlag);
// Restaurant onboarding (P7.4a): brands and their owner invites; accepting one is /api/me (PR 02).
adminRouter.get('/brands', admin.listBrands);
adminRouter.post('/brands', writeLimiter, validate(createBrandSchema), admin.createBrand);
adminRouter.post(
  '/brands/:brandId/invites',
  writeLimiter,
  validate(createBrandInviteSchema),
  admin.createOwnerInvite,
);
adminRouter.delete('/brands/:brandId/invites/:inviteId', writeLimiter, admin.revokeOwnerInvite);
