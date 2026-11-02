import { Router } from 'express';
import * as admin from '../controllers/admin.controller';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { writeLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { auditQuerySchema, updateSettingsSchema } from '../schemas/admin.schema';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get('/settings', admin.getSettings);
adminRouter.patch('/settings', writeLimiter, validate(updateSettingsSchema), admin.updateSettings);
adminRouter.get('/audit', validate(auditQuerySchema, 'query'), admin.listAudit);
