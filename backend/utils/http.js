import { createHash, timingSafeEqual } from 'node:crypto';
export class HttpError extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const hash = (s) => createHash('sha256').update(s).digest('hex');

export const equal = (a, b) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
