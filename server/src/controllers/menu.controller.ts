import type { RequestHandler } from 'express';
import * as menuService from '../services/menu.service';

export const getMenu: RequestHandler = async (_req, res) => {
  res.json(await menuService.getMenu());
};
