import { RateBucket } from '../models/RateBucket.js';
import { hash, HttpError } from '../utils/http.js';

const localBuckets = new Map();
let localChecks = 0;

export function localRateLimit(scope, max, ms) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${scope}:${req.ip || 'unknown'}:${Math.floor(now / ms)}`;
    const current = localBuckets.get(key);
    const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + ms };
    bucket.count += 1;
    localBuckets.set(key, bucket);

    localChecks += 1;
    if (localChecks % 256 === 0) {
      for (const [bucketKey, value] of localBuckets) {
        if (value.resetAt <= now) localBuckets.delete(bucketKey);
      }
    }

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil(ms / 1000)));
      return next(new HttpError(429, 'Too many requests. Try again shortly.'));
    }
    next();
  };
}

export function rateLimit(scope, max, ms) {
  return async (req, res, next) => {
    try {
      const now = Date.now();
      const id = hash(`${scope}:${req.ip}:${Math.floor(now / ms)}`);
      let bucket;
      try {
        bucket = await RateBucket.findOneAndUpdate(
          { _id: id },
          { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(now + ms * 2) } },
          { upsert: true, new: true },
        );
      } catch (error) {
        if (error.code !== 11000) throw error;
        bucket = await RateBucket.findOneAndUpdate({ _id: id }, { $inc: { count: 1 } }, { new: true });
      }
      if (bucket.count > max) {
        res.setHeader('Retry-After', String(Math.ceil(ms / 1000)));
        throw new HttpError(429, 'Too many requests. Try again shortly.');
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
