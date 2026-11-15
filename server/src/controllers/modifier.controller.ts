import type { RequestHandler } from 'express';
import { currentStore, requestContext } from '../middleware/auth';
import type {
  SaveModifierGroupInput,
  SetItemModifierGroupsInput,
} from '../schemas/modifier.schema';
import * as modifierService from '../services/modifier.service';
import type { BodyHandler } from '../types/http';
import { toModifierGroupDto } from '../utils/serializers';

// The modifier editor (P3.2, PR 14), every route after requireStore('menu.edit').

/** GET /api/stores/:storeId/modifier-groups: the live groups, and each item's group ids in order. */
export const listModifierGroups: RequestHandler = async (req, res) => {
  const { groups, itemGroupIds } = await modifierService.listStoreModifiers(currentStore(req).id);
  res.json({ groups: groups.map(toModifierGroupDto), itemGroupIds });
};

/** POST /api/stores/:storeId/modifier-groups. */
export const createModifierGroup: BodyHandler<SaveModifierGroupInput> = async (req, res) => {
  const group = await modifierService.saveModifierGroup(
    currentStore(req).id,
    undefined,
    req.body,
    requestContext(req),
  );
  res.status(201).json({ group: toModifierGroupDto(group) });
};

/** PATCH /api/stores/:storeId/modifier-groups/:groupId: the whole group, options included. */
export const updateModifierGroup: BodyHandler<SaveModifierGroupInput> = async (req, res) => {
  const group = await modifierService.saveModifierGroup(
    currentStore(req).id,
    String(req.params.groupId),
    req.body,
    requestContext(req),
  );
  res.json({ group: toModifierGroupDto(group) });
};

/** DELETE /api/stores/:storeId/modifier-groups/:groupId: archives; a repeat is 204 too. */
export const archiveModifierGroup: RequestHandler = async (req, res) => {
  await modifierService.archiveModifierGroup(
    currentStore(req).id,
    String(req.params.groupId),
    requestContext(req),
  );
  res.status(204).end();
};

/** PUT /api/stores/:storeId/menu-items/:itemId/modifier-groups: the item's groups, in order. */
export const setItemModifierGroups: BodyHandler<SetItemModifierGroupsInput> = async (req, res) => {
  await modifierService.setItemModifierGroups(
    currentStore(req).id,
    String(req.params.itemId),
    req.body.groupIds,
    requestContext(req),
  );
  res.json({ groupIds: req.body.groupIds.map((id) => id.toLowerCase()) });
};
