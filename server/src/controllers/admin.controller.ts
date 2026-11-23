import type { RequestHandler } from 'express';
import { currentStore, requestContext } from '../middleware/auth';
import type {
  AuditQuery,
  CreateBrandInput,
  CreateBrandInviteInput,
  UpdateFlagInput,
  UpdateSettingsInput,
} from '../schemas/admin.schema';
import * as adminBrandService from '../services/adminBrand.service';
import * as auditService from '../services/audit.service';
import * as flagsService from '../services/flags.service';
import * as settingsService from '../services/settings.service';
import type { AuditPageDto } from '../types/api';
import type { BodyHandler, QueryHandler } from '../types/http';
import { toAuditEntryDto, toFeatureFlagDto, toSiteSettingsDto } from '../utils/serializers';

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

export const updateFlag: BodyHandler<UpdateFlagInput, { key: string }> = async (req, res) => {
  const ctx = requestContext(req);
  const flag = toFeatureFlagDto(await flagsService.setFlag(req.params.key, req.body, ctx));
  // Which rules changed, not their contents (up to 100 store ids): audit_log holds the full change.
  const { enabled, clientVisible, rules } = req.body;
  req.log.info(
    { key: flag.key, enabled, clientVisible, rules: rules && Object.keys(rules), by: ctx.actor.id },
    'Feature flag changed',
  );
  res.json({ flag });
};

/** GET /api/stores/:storeId/audit, after requireStore('audit.store'): the store comes from `req.store`, not the query. */
export const listStoreAudit: QueryHandler<AuditQuery> = async (req, res) => {
  const { rows, nextCursor } = await auditService.listAudit(req.query, currentStore(req).id);
  const page: AuditPageDto = { entries: rows.map(toAuditEntryDto), nextCursor };
  res.set('Cache-Control', 'no-store').json(page);
};

// Restaurant onboarding (P7.4a). Owner and invitee emails: never cached by the browser, never logged.
export const listBrands: RequestHandler = async (_req, res) => {
  res.set('Cache-Control', 'no-store').json({ brands: await adminBrandService.listBrands() });
};

export const createBrand: BodyHandler<CreateBrandInput> = async (req, res) => {
  const ctx = requestContext(req);
  const brand = await adminBrandService.createBrand(req.body, ctx);
  req.log.info({ brandId: brand.id, by: ctx.actor.id }, 'Brand created');
  res.status(201).set('Cache-Control', 'no-store').json({ brand });
};

export const createOwnerInvite: BodyHandler<CreateBrandInviteInput, { brandId: string }> = async (
  req,
  res,
) => {
  const ctx = requestContext(req);
  const { invite, token } = await adminBrandService.createOwnerInvite(
    req.params.brandId,
    req.body.email,
    ctx,
  );
  req.log.info(
    { brandId: req.params.brandId, inviteId: invite.id, by: ctx.actor.id },
    'Owner invite created',
  );
  // The token is here once and never again: never stored by a cache.
  res.status(201).set('Cache-Control', 'no-store').json({ invite, token });
};

export const revokeOwnerInvite: RequestHandler<{ brandId: string; inviteId: string }> = async (
  req,
  res,
) => {
  const ctx = requestContext(req);
  const closed = await adminBrandService.revokeOwnerInvite(
    req.params.brandId,
    req.params.inviteId,
    ctx,
  );
  // A repeat changed nothing: no line for it.
  if (closed)
    req.log.info(
      { brandId: req.params.brandId, inviteId: req.params.inviteId, by: ctx.actor.id },
      'Owner invite revoked',
    );
  res.status(204).end();
};
