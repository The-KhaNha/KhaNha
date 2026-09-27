import type { RequestHandler } from 'express';
import * as storeService from '../services/store.service';
import { toStoreDto } from '../utils/serializers';

export const getStore: RequestHandler = async (_req, res) => {
  res.json({ store: toStoreDto(await storeService.getCachedStore()) });
};
