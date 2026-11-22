import { Router } from 'express';
import { requireAuth, allow, rateLimit } from '../middlewares/security.js';
import {
  getSystem,
  getSettings,
  patchSettings,
  patchSettingsRate,
  getUsers,
  postUsers,
  patchUsersId,
  getAudit,
} from '../controllers/settings.controller.js';
export const settings = Router();
settings.use(['/system', '/settings', '/users', '/audit'], requireAuth);
settings.get('/system', allow('settings'), getSystem);
settings.get('/settings', getSettings);
settings.patch('/settings', allow('settings'), patchSettings);
settings.patch('/settings/rate', allow('rate'), patchSettingsRate);
settings.get('/users', allow('users'), getUsers);
settings.post('/users', allow('users'), postUsers);
settings.patch('/users/:id', allow('users'), patchUsersId);
settings.get('/audit', allow('activity'), getAudit);
