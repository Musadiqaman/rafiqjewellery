import { visiblePurchase } from './purchases.js';
import { createHmac } from 'node:crypto';
import { Types } from 'mongoose';
import { listSchema, normalizeName, escapeRegex } from '../validators/domain.js';
import { env } from '../config/env.js';
import { hash, equal, HttpError } from '../middlewares/security.js';
function weightSearchConditions(value, allowBareInteger = false) {
  const trimmed = String(value || '').trim(),
    tokenPattern = /(\d+(?:\.\d+)?)\s*(g|grams?|tolas?)\b/gi,
    matches = [...trimmed.matchAll(tokenPattern)];

  if (matches.length) {
    const remainder = trimmed
      .replace(tokenPattern, '')
      .replace(/[\s/·|,;:+()[\]{}-]/g, '');
    if (remainder) return null;
    return matches.map((match) => {
      const value = Number(match[1]),
        precision = (match[1].split('.')[1] || '').length,
        tolerance = 0.5 * 10 ** -precision,
        field = /^tolas?$/i.test(match[2]) ? 'tola' : 'grams';
      return { [field]: { $gte: Math.max(0, value - tolerance), $lt: value + tolerance } };
    });
  }

  if (/^\d+(?:\.\d+)?$/.test(trimmed) && (allowBareInteger || trimmed.includes('.'))) {
    const value = Number(trimmed),
      precision = (trimmed.split('.')[1] || '').length,
      tolerance = 0.5 * 10 ** -precision;
    return [{ grams: { $gte: Math.max(0, value - tolerance), $lt: value + tolerance } }];
  }
  return null;
}

function phoneSearchConditions(digits) {
  const variants = new Set([digits]);
  if (digits.startsWith('03')) {
    variants.add('92' + digits.slice(1));
    variants.add('0092' + digits.slice(1));
  }
  if (digits.startsWith('92') && digits.length > 2) variants.add('0' + digits.slice(2));
  if (digits.startsWith('0092') && digits.length > 4) variants.add('0' + digits.slice(4));
  if (digits.startsWith('3')) variants.add('0' + digits);

  return [...variants].map((value) => {
    const pattern = '^\\+?' + value.split('').map(escapeRegex).join('[\\s().-]*');
    return { 'customer.phone': { $regex: pattern } };
  });
}

export function buildQuery(raw) {
  const input = listSchema.parse(raw),
    clauses = [];
  if (input.from || input.to) {
    const d = {};
    if (input.from) d.$gte = new Date(input.from + 'T00:00:00+05:00');
    if (input.to) d.$lt = new Date(new Date(input.to + 'T00:00:00+05:00').getTime() + 86400000);
    if (Object.values(d).some((v) => isNaN(v.getTime())))
      throw new HttpError(400, 'Invalid date range');
    clauses.push({ purchasedAt: d });
  }
  if (input.status === 'void') clauses.push({ voided: true });
  else if (input.status === 'active') clauses.push({ voided: false });
  if (input.q) {
    const digits = input.q.replace(/\D/g, ''),
      numericSearch = /^[\d\s+().-]+$/.test(input.q) && digits.length >= 2,
      looksLikePhone = /^(0?3|92|0092)/.test(digits),
      trimmed = input.q.trim(),
      weightConditions = weightSearchConditions(trimmed, input.field === 'weight'),
      field =
        input.field === 'all'
          ? weightConditions
            ? 'weight'
            : numericSearch
              ? looksLikePhone
                ? 'phoneOrCnic'
                : 'cnic'
              : /^RJ-/i.test(input.q)
                ? 'reference'
                : 'name'
          : input.field;

    if (field === 'weight') {
      const conditions = weightConditions || weightSearchConditions(trimmed, true);
      if (!conditions)
        throw new HttpError(400, 'Enter a weight in grams or tola, e.g. 11.664g or 1 tola');
      clauses.push(conditions.length === 1 ? conditions[0] : { $or: conditions });
    }

    if (field === 'cnic') {
      if (!/^\d{2,13}$/.test(digits))
        throw new HttpError(400, 'Enter at least the first 2 CNIC digits (maximum 13)');
      clauses.push(
        digits.length === 13
          ? { 'customer.cnic': digits }
          : { 'customer.cnic': { $regex: '^' + escapeRegex(digits) } },
      );
    }

    if (field === 'phone' || field === 'phoneOrCnic') {
      if (!/^\d{2,15}$/.test(digits))
        throw new HttpError(400, 'Enter at least the first 2 phone digits');
      const phoneConditions = phoneSearchConditions(digits);
      if (field === 'phone') {
        clauses.push({ $or: phoneConditions });
      } else {
        const alternatives = [...phoneConditions];
        if (digits.length <= 13) {
          alternatives.unshift(
            digits.length === 13
              ? { 'customer.cnic': digits }
              : { 'customer.cnic': { $regex: '^' + escapeRegex(digits) } },
          );
        }
        clauses.push({ $or: alternatives });
      }
    }

    if (field === 'name') clauses.push({ 'customer.namePrefixes': normalizeName(input.q) });
    if (field === 'reference')
      clauses.push({ reference: { $regex: '^' + escapeRegex(input.q.toUpperCase()) } });
  }
  clauses.push(visiblePurchase);
  const base = clauses.length ? { $and: [...clauses] } : {},
    signature = hash(JSON.stringify({ ...input, cursor: undefined, limit: undefined }));
  if (input.cursor) {
    try {
      const parts = input.cursor.split('.');
      if (parts.length !== 2) throw Error();
      const [p, mac] = parts;
      if (
        !p ||
        !mac ||
        !equal(mac, createHmac('sha256', env.SESSION_SECRET).update(p).digest('base64url'))
      )
        throw Error();
      const c = JSON.parse(Buffer.from(p, 'base64url').toString());
      if (
        c.filter !== signature ||
        !Types.ObjectId.isValid(c.id) ||
        !Number.isFinite(Date.parse(c.date))
      )
        throw Error();
      const date = new Date(c.date);
      clauses.push({
        $or: [
          { purchasedAt: { $lt: date } },
          { purchasedAt: date, _id: { $lt: new Types.ObjectId(c.id) } },
        ],
      });
    } catch {
      throw new HttpError(400, 'Invalid page cursor');
    }
  }
  return {
    input,
    base,
    filter: clauses.length ? { $and: clauses } : {},
    cursor: (r) => {
      const p = Buffer.from(
        JSON.stringify({
          id: String(r._id),
          date: new Date(r.purchasedAt).toISOString(),
          filter: signature,
        }),
      ).toString('base64url');
      return p + '.' + createHmac('sha256', env.SESSION_SECRET).update(p).digest('base64url');
    },
  };
}
