import { Router } from 'express';
import * as menu from '../controllers/menu.controller';

export const menuRouter = Router();

menuRouter.get('/', menu.getMenu);
