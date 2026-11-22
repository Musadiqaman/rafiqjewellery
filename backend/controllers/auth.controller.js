import { createInitialAdmin, finishSetup, protectPrimaryAdmin } from '../services/setup.js';

import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { User, Challenge } from '../models/index.js';
import { env, CHALLENGE_COOKIE, cookieOptions } from '../config/env.js';
import { HttpError, createAccessTokenResponse, equal, hash, audit } from '../middlewares/security.js';
import { setupSchema, loginSchema, passwordSchema, roles } from '../validators/domain.js';

let webAuthnPromise;
const loadWebAuthn = () => {
  webAuthnPromise ||= import('@simplewebauthn/server');
  return webAuthnPromise;
};
let dummyHashPromise;
const getDummyHash = () => {
  dummyHashPromise ||= bcrypt.hash('unavailable-account-comparison', 12);
  return dummyHashPromise;
};
export const getStatus = async (_req, res) => {
  await finishSetup();
  await protectPrimaryAdmin();
  res.json({ setupRequired: !(await User.exists({ role: 'admin' })), mode: 'live' });
};

export const postSetup = async (req, res) => {
  const d = setupSchema.parse(req.body);
  if (!equal(d.setupKey, env.SETUP_KEY)) throw new HttpError(403, 'Invalid installation setup key');
  const user = await createInitialAdmin(d, req);
  res.status(201).json(createAccessTokenResponse(user));
};

export const postLogin = async (req, res) => {
  const d = loginSchema.parse(req.body),
    u = await User.findOne({ email: d.email }).select('+passwordHash');
  const comparisonHash = u?.passwordHash || (await getDummyHash());
  const valid = await bcrypt.compare(d.password, comparisonHash);
  if (!u || !valid || !u.active) throw new HttpError(401, 'Email or password is incorrect');
  if (!roles.includes(u.role))
    throw new HttpError(403, 'This account role is no longer available. Ask an administrator to assign Admin or Cashier access.');
  req.user = u;
  await audit(req, 'session.login');
  res.json(createAccessTokenResponse(u));
};

export const getMe = (req, res) =>
  res.json({
    user: {
      id: String(req.user._id),
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
    },
  });

export const postLogout = (_req, res) => res.json({ ok: true });

export const postPassword = async (req, res) => {
  const d = z
      .object({ oldPassword: z.string().max(72), newPassword: passwordSchema })
      .strict()
      .parse(req.body),
    u = await User.findById(req.user._id).select('+passwordHash');
  if (!u || !(await bcrypt.compare(d.oldPassword, u.passwordHash)))
    throw new HttpError(400, 'Current password is incorrect');
  u.passwordHash = await bcrypt.hash(d.newPassword, 12);
  u.authVersion = (u.authVersion || 0) + 1;
  await u.save();
  await audit(req, 'account.password_changed');
  res.json(createAccessTokenResponse(u));
};

export const postPasskeysRegisterOptions = async (req, res) => {
  const u = await User.findById(req.user._id);
  const { generateRegistrationOptions } = await loadWebAuthn();
  const options = await generateRegistrationOptions({
    rpName: 'Rafiq Jewellery',
    rpID: env.RP_ID,
    userName: req.user.email,
    userDisplayName: req.user.name,
    userID: new Uint8Array(Buffer.from(String(req.user._id))),
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: (u?.passkeys || []).map((p) => ({
      id: p.id,
      transports: p.transports,
    })),
  });
  await Challenge.findOneAndUpdate(
    { _id: req.auth.jti + '.register' },
    {
      userId: req.user._id,
      challenge: options.challenge,
      type: 'register',
      expiresAt: new Date(Date.now() + 300000),
    },
    { upsert: true },
  );
  res.json(options);
};

export const postPasskeysRegisterVerify = async (req, res) => {
  const c = await Challenge.findOneAndDelete({ _id: req.auth.jti + '.register' });
  if (!c?.expiresAt || c.expiresAt.getTime() < Date.now())
    throw new HttpError(400, 'Passkey request expired');
  const { verifyRegistrationResponse } = await loadWebAuthn();
  const v = await verifyRegistrationResponse({
    response: req.body,
    expectedChallenge: c.challenge,
    expectedOrigin: env.APP_ORIGIN,
    expectedRPID: env.RP_ID,
    requireUserVerification: true,
  });
  if (!v.verified || !v.registrationInfo) throw new HttpError(400, 'Passkey registration failed');
  const p = v.registrationInfo.credential;
  if (await User.exists({ 'passkeys.id': p.id }))
    throw new HttpError(409, 'Passkey already registered');
  await User.updateOne(
    { _id: req.user._id },
    {
      $push: {
        passkeys: {
          id: p.id,
          publicKey: Buffer.from(p.publicKey).toString('base64'),
          counter: p.counter,
          transports: p.transports,
          createdAt: new Date(),
        },
      },
    },
  );
  await audit(req, 'passkey.registered');
  res.json({ verified: true });
};

export const postPasskeysLoginOptions = async (_req, res) => {
  const { generateAuthenticationOptions } = await loadWebAuthn();
  const options = await generateAuthenticationOptions({
      rpID: env.RP_ID,
      userVerification: 'required',
    }),
    key = randomBytes(32).toString('base64url');
  await Challenge.create({
    _id: hash(key),
    challenge: options.challenge,
    type: 'login',
    expiresAt: new Date(Date.now() + 300000),
  });
  res.cookie(CHALLENGE_COOKIE, key, { ...cookieOptions, maxAge: 300000 });
  res.json(options);
};

export const postPasskeysLoginVerify = async (req, res) => {
  const id = z.string().max(2048).parse(req.body?.id),
    key = req.cookies[CHALLENGE_COOKIE];
  res.clearCookie(CHALLENGE_COOKIE, cookieOptions);
  if (!key) throw new HttpError(400, 'Passkey request expired');
  const c = await Challenge.findOneAndDelete({ _id: hash(key) });
  if (!c?.expiresAt || c.expiresAt.getTime() < Date.now())
    throw new HttpError(400, 'Passkey request expired');
  const u = await User.findOne({ 'passkeys.id': id, active: true }),
    p = u?.passkeys.find((x) => x.id === id);
  if (!u || !p) throw new HttpError(401, 'Passkey not recognized');
  if (!roles.includes(u.role))
    throw new HttpError(403, 'This account role is no longer available. Ask an administrator to assign Admin or Cashier access.');
  const { verifyAuthenticationResponse } = await loadWebAuthn();
  const v = await verifyAuthenticationResponse({
    response: req.body,
    expectedChallenge: c.challenge,
    expectedOrigin: env.APP_ORIGIN,
    expectedRPID: env.RP_ID,
    credential: {
      id: p.id,
      publicKey: new Uint8Array(Buffer.from(p.publicKey, 'base64')),
      counter: p.counter,
      transports: p.transports,
    },
    requireUserVerification: true,
  });
  if (!v.verified) throw new HttpError(401, 'Passkey verification failed');
  await User.updateOne(
    { _id: u._id, 'passkeys.id': id },
    { $set: { 'passkeys.$.counter': v.authenticationInfo.newCounter } },
  );
  req.user = u;
  await audit(req, 'session.passkey_login');
  res.json(createAccessTokenResponse(u));
};
