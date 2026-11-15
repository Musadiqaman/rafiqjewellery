import { createHmac, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { equal } from './http.js';

export const ACCESS_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;
const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

function sign(value) {
  return createHmac('sha256', env.SESSION_SECRET).update(value).digest('base64url');
}

export function issueAccessToken(user, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const payload = {
    sub: String(user._id),
    ver: Number(user.authVersion || 0),
    iat: issuedAt,
    exp: issuedAt + ACCESS_TOKEN_TTL_SECONDS,
    jti: randomBytes(24).toString('base64url'),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const unsigned = `${HEADER}.${body}`;
  return {
    token: `${unsigned}.${sign(unsigned)}`,
    expiresAt: payload.exp * 1000,
  };
}

export function verifyAccessToken(token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== HEADER || !parts[1] || !parts[2]) return null;

  const unsigned = `${parts[0]}.${parts[1]}`;
  if (!equal(parts[2], sign(unsigned))) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const nowSeconds = Math.floor(now / 1000);
    if (
      !payload ||
      typeof payload.sub !== 'string' ||
      !/^[a-f\d]{24}$/i.test(payload.sub) ||
      !Number.isSafeInteger(payload.ver) ||
      payload.ver < 0 ||
      !Number.isSafeInteger(payload.iat) ||
      !Number.isSafeInteger(payload.exp) ||
      payload.iat > nowSeconds + 60 ||
      payload.exp <= nowSeconds ||
      payload.exp - payload.iat !== ACCESS_TOKEN_TTL_SECONDS ||
      typeof payload.jti !== 'string' ||
      payload.jti.length < 20
    )
      return null;
    return payload;
  } catch {
    return null;
  }
}
