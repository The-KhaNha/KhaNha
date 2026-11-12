import type { RequestHandler } from 'express';
import * as menuService from '../services/menu.service';
import * as storeService from '../services/store.service';
import type { StoreListQuery, UpdateStoreProfileInput } from '../schemas/store.schema';
import { currentStore, requestContext } from '../middleware/auth';
import type { UpdateStoreSettingsInput } from '../schemas/storeSettings.schema';
import * as scheduleService from '../services/schedule.service';
import type { CreateExceptionInput, SetStoreHoursInput } from '../schemas/storeHours.schema';
import * as hoursService from '../services/storeHours.service';
import * as settingsService from '../services/storeSettings.service';
import * as pauseService from '../services/storePause.service';
import type { PauseStoreInput } from '../schemas/storePause.schema';
import type { BodyHandler } from '../types/http';
import { toStoreDto, toStoreSettingsDto, type StoreWithBrand } from '../utils/serializers';

export const listStores: RequestHandler = async (req, res) => {
  const { area } = req.query as StoreListQuery;
  res.json({ stores: await storeService.listStores(area) });
};

const storeDto = async (store: StoreWithBrand) =>
  toStoreDto(store, await scheduleService.getOpenFields(store));

const activeStore = async (ref: string | string[] | undefined) =>
  storeService.getActiveStore(await storeService.resolveStoreRef(String(ref)));

export const getStoreByRef: RequestHandler = async (req, res) => {
  res.json({ store: await storeDto(await activeStore(req.params.storeRef)) });
};

export const getStoreMenu: RequestHandler = async (req, res) => {
  res.json(await menuService.getStoreMenu(await activeStore(req.params.storeRef)));
};

/** GET /api/stores/:storeRef/hours: public, the week and the exceptions from today on. */
export const getStoreHours: RequestHandler = async (req, res) => {
  res.json(await scheduleService.getStoreSchedule(await activeStore(req.params.storeRef)));
};

/** GET /api/stores/:storeId/settings, after requireStore('settings.edit'). */
export const getStoreSettings: RequestHandler = async (req, res) => {
  res.json({
    settings: toStoreSettingsDto(await settingsService.getStoreSettings(currentStore(req).id)),
  });
};

/** PATCH /api/stores/:storeId/settings, after requireStore('settings.edit'). */
export const updateStoreSettings: BodyHandler<UpdateStoreSettingsInput> = async (req, res) => {
  const settings = await settingsService.updateStoreSettings(
    currentStore(req).id,
    req.body,
    requestContext(req),
  );
  res.json({ settings: toStoreSettingsDto(settings) });
};

/** PUT /api/stores/:storeId/hours, after requireStore('hours.edit'). Answers with the saved schedule. */
export const setStoreHours: BodyHandler<SetStoreHoursInput> = async (req, res) => {
  const store = currentStore(req);
  await hoursService.setStoreHours(store.id, req.body, requestContext(req));
  res.json(await scheduleService.getStoreSchedule(await storeService.getStoreById(store.id)));
};

/** POST /api/stores/:storeId/schedule-exceptions, after requireStore('hours.edit'). */
export const createScheduleException: BodyHandler<CreateExceptionInput> = async (req, res) => {
  const store = currentStore(req);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: store.timezone }).format(new Date());
  const exception = await hoursService.createException(
    store.id,
    today,
    req.body,
    requestContext(req),
  );
  res.status(201).json({ exception });
};

/** DELETE /api/stores/:storeId/schedule-exceptions/:exceptionId, after requireStore('hours.edit'). */
export const deleteScheduleException: RequestHandler = async (req, res) => {
  await hoursService.deleteException(
    currentStore(req).id,
    String(req.params.exceptionId),
    requestContext(req),
  );
  res.status(204).end();
};

// A pause or a resume answers with the store as customers now see it, read uncached.
const freshStore = async (id: string) => storeDto(await storeService.getStore(id));

/** POST /api/stores/:storeId/pause, after requireStore('store.pause'). */
export const pauseStore: BodyHandler<PauseStoreInput> = async (req, res) => {
  const { id } = currentStore(req);
  await pauseService.pauseStore(id, req.body, requestContext(req));
  res.json({ store: await freshStore(id) });
};

/** POST /api/stores/:storeId/resume, after requireStore('store.pause'). */
export const resumeStore: RequestHandler = async (req, res) => {
  const { id } = currentStore(req);
  await pauseService.resumeStore(id, requestContext(req));
  res.json({ store: await freshStore(id) });
};

/** PATCH /api/stores/:storeId/profile, after requireStore('store.profile'). */
export const updateStoreProfile: BodyHandler<UpdateStoreProfileInput> = async (req, res) => {
  const { id, status } = currentStore(req);
  const store = await storeService.updateStoreProfile(id, status, req.body, requestContext(req));
  res.json({ store });
};

/** POST /api/stores/:storeId/publish, after requireStore('store.publish'). */
export const publishStore: RequestHandler = async (req, res) => {
  res.json({
    store: await storeService.setStoreStatus(currentStore(req).id, 'ACTIVE', requestContext(req)),
  });
};

/** POST /api/stores/:storeId/unpublish, after requireStore('store.publish'). */
export const unpublishStore: RequestHandler = async (req, res) => {
  res.json({
    store: await storeService.setStoreStatus(currentStore(req).id, 'DRAFT', requestContext(req)),
  });
};
