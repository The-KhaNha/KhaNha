import type { RequestHandler } from 'express';
import * as configService from '../services/config.service';

export const getConfig: RequestHandler = async (_req, res) => {
  res.json(await configService.getConfig());
};
