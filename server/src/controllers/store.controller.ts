import type { RequestHandler } from 'express';
import * as menuService from '../services/menu.service';
import * as storeService from '../services/store.service';
import type { StoreListQuery } from '../schemas/store.schema';
import { currentStore, requestContext } from '../middleware/auth';
import type { UpdateStoreSettingsInput } from '../schemas/storeSettings.schema';
import * as scheduleService from '../services/schedule.service';
import * as settingsService from '../services/storeSettings.service';
import type { BodyHandler } from '../types/http';
import { toStoreDto, toStoreSettingsDto, type StoreWithBrand } from '../utils/serializers';

export const getStore: RequestHandler = async (_req, res) => {
  res.json({ store: await storeDto(await storeService.getCachedStore()) });
};

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
