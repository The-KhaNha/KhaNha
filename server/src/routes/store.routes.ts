import { Router } from 'express';
import * as store from '../controllers/store.controller';
import { validate } from '../middleware/validate';
import { storeListQuerySchema, storeRefParamsSchema } from '../schemas/store.schema';

export const storeRouter = Router();

storeRouter.get('/', store.getStore);

export const storesRouter = Router();

storesRouter.get('/', validate(storeListQuerySchema, 'query'), store.listStores);
storesRouter.get('/:storeRef', validate(storeRefParamsSchema, 'params'), store.getStoreByRef);
storesRouter.get('/:storeRef/menu', validate(storeRefParamsSchema, 'params'), store.getStoreMenu);
