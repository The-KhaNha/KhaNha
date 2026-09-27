import { Router } from 'express';
import * as admin from '../controllers/admin.controller';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { updateSettingsSchema } from '../schemas/admin.schema';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get('/settings', admin.getSettings);
adminRouter.patch('/settings', validate(updateSettingsSchema), admin.updateSettings);
