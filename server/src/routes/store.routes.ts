import { Router } from 'express';
import * as admin from '../controllers/admin.controller';
import * as menu from '../controllers/menu.controller';
import * as orders from '../controllers/order.controller';
import * as store from '../controllers/store.controller';
import * as team from '../controllers/team.controller';
import { requireAuth, requireStore } from '../middleware/auth';
import { writeLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { auditQuerySchema } from '../schemas/admin.schema';
import { createMenuItemSchema, updateMenuItemSchema } from '../schemas/menuItem.schema';
import { listOrdersQuerySchema, updateOrderStatusSchema } from '../schemas/order.schema';
import { updateStoreSettingsSchema } from '../schemas/storeSettings.schema';
import {
  storeListQuerySchema,
  storeRefParamsSchema,
  updateStoreProfileSchema,
} from '../schemas/store.schema';
import { createExceptionSchema, setStoreHoursSchema } from '../schemas/storeHours.schema';
import { createInviteSchema } from '../schemas/team.schema';
import { pauseStoreSchema } from '../schemas/storePause.schema';

export const storesRouter = Router();

storesRouter.get('/', validate(storeListQuerySchema, 'query'), store.listStores);
storesRouter.get('/:storeRef', validate(storeRefParamsSchema, 'params'), store.getStoreByRef);
storesRouter.get('/:storeRef/hours', validate(storeRefParamsSchema, 'params'), store.getStoreHours);
storesRouter.get('/:storeRef/menu', validate(storeRefParamsSchema, 'params'), store.getStoreMenu);

// Store-scoped staff routes (P2.3): requireStore admits the caller by capability (domain/permissions.ts).
storesRouter.get(
  '/:storeId/orders',
  requireAuth,
  requireStore('orders.view'),
  validate(listOrdersQuerySchema, 'query'),
  orders.listStoreOrders,
);
storesRouter.patch(
  '/:storeId/orders/:orderId/status',
  requireAuth,
  requireStore('orders.transition'),
  writeLimiter,
  validate(updateOrderStatusSchema),
  orders.updateStoreOrderStatus,
);
storesRouter.get(
  '/:storeId/settings',
  requireAuth,
  requireStore('settings.edit'),
  store.getStoreSettings,
);
storesRouter.patch(
  '/:storeId/settings',
  requireAuth,
  requireStore('settings.edit'),
  writeLimiter,
  validate(updateStoreSettingsSchema),
  store.updateStoreSettings,
);
// Opening hours (P2.4): the week is replaced whole; exceptions are added and removed one at a time.
storesRouter.put(
  '/:storeId/hours',
  requireAuth,
  requireStore('hours.edit'),
  writeLimiter,
  validate(setStoreHoursSchema),
  store.setStoreHours,
);
storesRouter.post(
  '/:storeId/schedule-exceptions',
  requireAuth,
  requireStore('hours.edit'),
  writeLimiter,
  validate(createExceptionSchema),
  store.createScheduleException,
);
storesRouter.delete(
  '/:storeId/schedule-exceptions/:exceptionId',
  requireAuth,
  requireStore('hours.edit'),
  writeLimiter,
  store.deleteScheduleException,
);
storesRouter.get(
  '/:storeId/audit',
  requireAuth,
  requireStore('audit.store'),
  validate(auditQuerySchema, 'query'),
  admin.listStoreAudit,
);
// The team (P2.2): a manager manages staff; acting on a manager also needs team.manageManagers (team.controller.ts).
storesRouter.get('/:storeId/members', requireAuth, requireStore('team.manageStaff'), team.listTeam);
storesRouter.post(
  '/:storeId/invites',
  requireAuth,
  requireStore('team.manageStaff'),
  writeLimiter,
  validate(createInviteSchema),
  team.createInvite,
);
storesRouter.delete(
  '/:storeId/invites/:inviteId',
  requireAuth,
  requireStore('team.manageStaff'),
  writeLimiter,
  team.revokeInvite,
);
storesRouter.delete(
  '/:storeId/members/:membershipId',
  requireAuth,
  requireStore('team.manageStaff'),
  writeLimiter,
  team.removeMember,
);
// Pause and resume (P2.5): staff, managers, the owner, and an admin as support.
storesRouter.post(
  '/:storeId/pause',
  requireAuth,
  requireStore('store.pause'),
  writeLimiter,
  validate(pauseStoreSchema),
  store.pauseStore,
);
storesRouter.post(
  '/:storeId/resume',
  requireAuth,
  requireStore('store.pause'),
  writeLimiter,
  store.resumeStore,
);
// The menu editor (P3.4): managers and the owner; the brand's owner also edits the template's menu.
storesRouter.get(
  '/:storeId/menu-items',
  requireAuth,
  requireStore('menu.edit'),
  menu.listMenuItems,
);
storesRouter.post(
  '/:storeId/menu-items',
  requireAuth,
  requireStore('menu.edit'),
  writeLimiter,
  validate(createMenuItemSchema),
  menu.createMenuItem,
);
storesRouter.patch(
  '/:storeId/menu-items/:itemId',
  requireAuth,
  requireStore('menu.edit'),
  writeLimiter,
  validate(updateMenuItemSchema),
  menu.updateMenuItem,
);
storesRouter.delete(
  '/:storeId/menu-items/:itemId',
  requireAuth,
  requireStore('menu.edit'),
  writeLimiter,
  menu.archiveMenuItem,
);
// A branch's profile and whether it is public (P3.1, D6): managers edit the profile; only the owner publishes.
storesRouter.patch(
  '/:storeId/profile',
  requireAuth,
  requireStore('store.profile'),
  writeLimiter,
  validate(updateStoreProfileSchema),
  store.updateStoreProfile,
);
storesRouter.post(
  '/:storeId/publish',
  requireAuth,
  requireStore('store.publish'),
  writeLimiter,
  store.publishStore,
);
storesRouter.post(
  '/:storeId/unpublish',
  requireAuth,
  requireStore('store.publish'),
  writeLimiter,
  store.unpublishStore,
);
