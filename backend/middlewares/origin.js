import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http.js';
export function originGuard(req, res, next) {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== env.APP_ORIGIN)
    return next(new HttpError(403, 'Request origin is not permitted'));
  next();
}
