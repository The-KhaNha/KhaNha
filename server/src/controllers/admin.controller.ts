import type { RequestHandler } from 'express';
import { requestContext } from '../middleware/auth';
import type { AuditQuery, UpdateSettingsInput } from '../schemas/admin.schema';
import * as auditService from '../services/audit.service';
import * as settingsService from '../services/settings.service';
import type { AuditPageDto } from '../types/api';
import type { BodyHandler, QueryHandler } from '../types/http';
import { toAuditEntryDto, toSiteSettingsDto } from '../utils/serializers';

export const getSettings: RequestHandler = async (_req, res) => {
  res.json({ settings: toSiteSettingsDto(await settingsService.getSettings()) });
};

export const updateSettings: BodyHandler<UpdateSettingsInput> = async (req, res) => {
  const ctx = requestContext(req);
  const settings = toSiteSettingsDto(await settingsService.updateSettings(req.body, ctx));
  // The validated body holds only the settings that changed: no PII.
  req.log.info({ ...req.body, by: ctx.actor.id }, 'Site settings changed');
  res.json({ settings });
};

export const listAudit: QueryHandler<AuditQuery> = async (req, res) => {
  const { rows, nextCursor } = await auditService.listAudit(req.query);
  const page: AuditPageDto = { entries: rows.map(toAuditEntryDto), nextCursor };
  // Who changed what, by whom: kept out of the browser's cache so it cannot outlive the admin's sign-out. Not polled,
  // so the global no-cache + ETag would save nothing here.
  res.set('Cache-Control', 'no-store').json(page);
};
