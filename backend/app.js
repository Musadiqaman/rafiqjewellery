import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { auth } from './routes/auth.js';
import { records } from './routes/records.js';
import { settings } from './routes/settings.js';
import { originGuard, localRateLimit, HttpError } from './middlewares/security.js';
import { stripVercelRewritePath } from './middlewares/vercelRewrite.js';
export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY);

app.use(stripVercelRewritePath);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", 'https://localhost:*', 'https://127.0.0.1:*'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: '64kb' }));
app.use(
  '/api',
  (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  },
  originGuard,
);
app.get('/api/health', (_req, res) =>
  res
    .status(mongoose.connection.readyState === 1 ? 200 : 503)
    .json({ status: mongoose.connection.readyState === 1 ? 'ok' : 'unavailable' }),
);
app.use('/api', localRateLimit('api', 600, 60000));
app.use('/api/auth', auth);
app.use('/api', records, settings);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'API route not found')));
app.use((error, req, res, _next) => {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({
      error: error.issues[0]?.message || 'Invalid data',
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  if (error.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body is too large' });
    return;
  }
  if (error.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON request' });
    return;
  }
  if (error.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'Each image must be 3 MB or smaller' });
    return;
  }
  if (error.code === 11000) {
    res.status(409).json({ error: 'This account or record already exists' });
    return;
  }
  const status = error instanceof HttpError ? error.status : 500;
  if (status === 500)
    console.error(JSON.stringify({ requestId: req.requestId, error: error.name }));
  res.status(status).json({
    error: status === 500 ? 'Unable to complete the request. Please retry.' : error.message,
    requestId: req.requestId,
    ...(error.resetSubmission ? { resetSubmission: true } : {}),
  });
});
