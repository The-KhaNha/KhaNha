import { Router } from 'express';
import * as store from '../controllers/store.controller';

export const storeRouter = Router();

storeRouter.get('/', store.getStore);
