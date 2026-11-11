import type { RequestHandler } from 'express';
import * as menuService from '../services/menu.service';
import * as storeService from '../services/store.service';
import type { StoreListQuery } from '../schemas/store.schema';
import { toStoreDto } from '../utils/serializers';

export const getStore: RequestHandler = async (_req, res) => {
  res.json({ store: toStoreDto(await storeService.getCachedStore()) });
};

export const listStores: RequestHandler = async (req, res) => {
  const { area } = req.query as StoreListQuery;
  res.json({ stores: await storeService.listStores(area) });
};

const activeStore = async (ref: string | string[] | undefined) =>
  storeService.getActiveStore(await storeService.resolveStoreRef(String(ref)));

export const getStoreByRef: RequestHandler = async (req, res) => {
  res.json({ store: toStoreDto(await activeStore(req.params.storeRef)) });
};

export const getStoreMenu: RequestHandler = async (req, res) => {
  res.json(await menuService.getStoreMenu(await activeStore(req.params.storeRef)));
};
