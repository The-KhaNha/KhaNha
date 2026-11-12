import type { RequestHandler } from 'express';
import { currentUser, requestContext } from '../middleware/auth';
import type { CreateStoreInput } from '../schemas/store.schema';
import * as brandService from '../services/brand.service';
import type { BodyHandler } from '../types/http';

/** GET /api/brands/mine: the brands the caller owns; [] for anyone else. */
export const listMyBrands: RequestHandler = async (req, res) => {
  res.json({ brands: await brandService.listMyBrands(currentUser(req)) });
};

/** POST /api/brands/:brandId/stores: a new DRAFT branch, copied from the brand's template. */
export const createStore: BodyHandler<CreateStoreInput> = async (req, res) => {
  const store = await brandService.createStore(
    String(req.params.brandId),
    req.body,
    currentUser(req),
    requestContext(req),
  );
  res.status(201).json({ store });
};
