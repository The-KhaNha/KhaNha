import type { RequestHandler } from 'express';
import { currentStore, requestContext } from '../middleware/auth';
import type { CreateMenuItemInput, UpdateMenuItemInput } from '../schemas/menuItem.schema';
import * as menuService from '../services/menu.service';
import type { BodyHandler } from '../types/http';
import { toManagedMenuItemDto } from '../utils/serializers';

// The menu editor (P3.4), every route after requireStore('menu.edit').

/** GET /api/stores/:storeId/menu-items: every item, archived ones included. */
export const listMenuItems: RequestHandler = async (req, res) => {
  const items = await menuService.listManagedItems(currentStore(req).id);
  res.json({ items: items.map(toManagedMenuItemDto) });
};

/** POST /api/stores/:storeId/menu-items. */
export const createMenuItem: BodyHandler<CreateMenuItemInput> = async (req, res) => {
  const item = await menuService.createMenuItem(
    currentStore(req).id,
    req.body,
    requestContext(req),
  );
  res.status(201).json({ item: toManagedMenuItemDto(item) });
};

/** PATCH /api/stores/:storeId/menu-items/:itemId. */
export const updateMenuItem: BodyHandler<UpdateMenuItemInput> = async (req, res) => {
  const item = await menuService.updateMenuItem(
    currentStore(req).id,
    String(req.params.itemId),
    req.body,
    requestContext(req),
  );
  res.json({ item: toManagedMenuItemDto(item) });
};

/** DELETE /api/stores/:storeId/menu-items/:itemId: archives; a repeat is 204 too. */
export const archiveMenuItem: RequestHandler = async (req, res) => {
  await menuService.archiveMenuItem(
    currentStore(req).id,
    String(req.params.itemId),
    requestContext(req),
  );
  res.status(204).end();
};
