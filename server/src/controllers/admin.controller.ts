import type { RequestHandler } from 'express';
import { currentUser } from '../middleware/auth';
import type { UpdateSettingsInput } from '../schemas/admin.schema';
import * as settingsService from '../services/settings.service';
import type { BodyHandler } from '../types/http';
import { toSiteSettingsDto } from '../utils/serializers';

export const getSettings: RequestHandler = async (_req, res) => {
  res.json({ settings: toSiteSettingsDto(await settingsService.getSettings()) });
};

export const updateSettings: BodyHandler<UpdateSettingsInput> = async (req, res) => {
  const admin = currentUser(req);
  const settings = toSiteSettingsDto(await settingsService.updateSettings(admin, req.body));
  // The validated body holds only the settings that changed: no PII.
  req.log.info({ ...req.body, by: admin.id }, 'Site settings changed');
  res.json({ settings });
};
