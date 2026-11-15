import { Router } from 'express';
import { requireAuth, allow, rateLimit } from '../middlewares/security.js';
import {
  getStatus,
  postSetup,
  postLogin,
  getMe,
  postLogout,
  postPassword,
  postPasskeysRegisterOptions,
  postPasskeysRegisterVerify,
  postPasskeysLoginOptions,
  postPasskeysLoginVerify,
} from '../controllers/auth.controller.js';
export const auth = Router();
auth.get('/status', getStatus);
auth.post('/setup', rateLimit('setup', 5, 900000), postSetup);
auth.post('/login', rateLimit('login', 10, 900000), postLogin);
auth.get('/me', requireAuth, getMe);
auth.post('/logout', postLogout);
auth.post('/password', requireAuth, rateLimit('password', 5, 900000), postPassword);
auth.post('/passkeys/register/options', requireAuth, postPasskeysRegisterOptions);
auth.post('/passkeys/register/verify', requireAuth, postPasskeysRegisterVerify);
auth.post(
  '/passkeys/login/options',
  rateLimit('passkey-options', 20, 900000),
  postPasskeysLoginOptions,
);
auth.post(
  '/passkeys/login/verify',
  rateLimit('passkey-verify', 10, 900000),
  postPasskeysLoginVerify,
);
