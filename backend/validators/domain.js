import { z } from 'zod';
export const GRAMS_PER_TOLA = 11.664;
export const roles = ['admin', 'manager', 'cashier', 'viewer'];
export const permissions = {
  admin: ['read', 'create', 'export', 'rate', 'void', 'delete', 'settings', 'users'],
  manager: ['read', 'create', 'export', 'rate', 'void', 'delete'],
  cashier: ['read', 'create'],
  viewer: ['read'],
};
export const can = (role, permission) => permissions[role]?.includes(permission) || false;
export const normalizeName = (s) => s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
export const namePrefixes = (s) => [
  ...new Set(
    [normalizeName(s), ...normalizeName(s).split(' ')].flatMap((w) =>
      Array.from({ length: w.length }, (_, i) => w.slice(0, i + 1)),
    ),
  ),
];
export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const cnicDigits = (s) => s.replace(/[-\s]/g, '');
export const formatCnic = (s = '') =>
  /^\d{13}$/.test(s) ? `${s.slice(0, 5)}-${s.slice(5, 12)}-${s.slice(12)}` : s;

export const formatCnicInput = (value = '') => {
  const digits = String(value).replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 5) return digits;
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
};
const plain = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[<>\u0000-\u001f]/.test(v), 'Use plain text');
export const weightSchema = z
  .object({
    mode: z.enum(['traditional', 'grams']),
    tola: z.number().min(0).max(10000),
    masha: z.number().min(0).max(11.999),
    ratti: z.number().min(0).max(7.999),
    grams: z.number().min(0).max(100000),
  })
  .strict()
  .refine(
    (w) => (w.mode === 'grams' ? w.grams : w.tola + w.masha / 12 + w.ratti / 96) > 0,
    'Enter a weight greater than zero',
  );
export function calculate(w, ratePaisa) {
  const tola = w.mode === 'grams' ? w.grams / GRAMS_PER_TOLA : w.tola + w.masha / 12 + w.ratti / 96;
  const totalPaisa = Math.round(tola * ratePaisa);
  return {
    tola,
    grams: Math.round(tola * GRAMS_PER_TOLA * 1e6) / 1e6,
    grossPaisa: totalPaisa,
    totalPaisa,
  };
}
export function weightFromGrams(grams) {
  const units = Math.round((grams / GRAMS_PER_TOLA) * 96000),
    tola = Math.floor(units / 96000),
    remainder = units - tola * 96000,
    masha = Math.floor(remainder / 8000);
  // Derive display fields only; grams remains the source of truth until another unit is edited.
  return {
    mode: 'grams',
    grams,
    tola,
    masha,
    ratti: (remainder - masha * 8000) / 1000,
  };
}
export function incrementWeight(w, unit) {
  if (w.mode === 'grams')
    return weightFromGrams(Number(w.grams) + GRAMS_PER_TOLA * (unit === 'masha' ? 1 / 12 : 0.5));
  if (unit === 'masha') {
    const masha = Number(w.masha || 0) + 1;
    return { ...w, tola: Number(w.tola || 0) + Math.floor(masha / 12), masha: masha % 12 };
  }
  return { ...w, tola: Number(w.tola || 0) + 0.5 };
}
const id = z.string().regex(/^[a-f\d]{24}$/);
export const entrySchema = z
  .object({
    weight: weightSchema,
    ratePaisa: z.number().int().min(100).max(1000000000),
    items: z.array(plain(60).min(1)).max(12).default([]),
    customer: z
      .object({
        name: plain(100).default(''),
        cnic: plain(15).default('').transform(cnicDigits),
        phone: plain(20).default(''),
      })
      .strict()
      .default({}),
    photoIds: z.array(id).max(8).default([]),
    signatureId: id.nullable().default(null),
    thumbId: id.nullable().default(null),
    thumbSource: z.enum(['scanner', 'camera', 'ink']).nullable().default(null),
    idempotencyKey: z.uuid(),
  })
  .strict()
  .superRefine((v, c) => {
    const issue = (path, message) => c.addIssue({ code: 'custom', path: path.split('.'), message });
    if (v.customer.cnic && !/^\d{13}$/.test(v.customer.cnic))
      issue('customer.cnic', 'Enter a valid 13-digit CNIC or leave it blank');
    if (v.customer.phone && !/^\+?[\d\s-]{7,20}$/.test(v.customer.phone))
      issue('customer.phone', 'Enter a valid phone number');
    if (v.thumbId && !v.thumbSource) issue('thumbSource', 'Select the thumb image source');
  });
export const passwordSchema = z
  .string()
  .min(6)
  .max(72)
  .refine(
    (s) => new TextEncoder().encode(s).length <= 72,
    'Password must be at most 72 UTF-8 bytes',
  );
export const loginSchema = z
  .object({ email: z.email().toLowerCase().max(254), password: passwordSchema })
  .strict();
export const setupSchema = loginSchema.extend({
  name: plain(100).min(2),
  shopName: plain(100).min(2),
  setupKey: z.string().min(16).max(200),
});
export const userSchema = loginSchema.extend({ name: plain(100).min(2), role: z.enum(roles) });
export const DEFAULT_AFFIDAVIT = `I, {{name}}, holder of CNIC No. {{cnic}}, declare that I am the lawful owner of the gold / ornaments weighing {{weight}} ({{tola}} tola), sold to {{shop}} on {{date}} at {{rate}} per tola for {{amount}}.\n\nThe gold is my own property, acquired lawfully and free from theft, dispute, lien or other encumbrance. I have sold it of my own free will.\n\nIf any claim is made regarding this gold, I shall be responsible for it and for the resulting losses and legal consequences. The information given by me is true to the best of my knowledge.`;
export const AFFIDAVIT_FIELDS = [
  'name',
  'cnic',
  'phone',
  'weight',
  'tola',
  'shop',
  'date',
  'rate',
  'amount',
];
export const settingsSchema = z
  .object({
    shopName: plain(100).min(2),
    address: plain(300),
    phone: plain(30),
    receiptSize: z.enum(['a4', '80mm', '58mm']),
    scannerUrl: z
      .string()
      .max(200)
      .refine(
        (v) => !v || /^https:\/\/(localhost|127\.0\.0\.1)(:\d{2,5})?\/?$/.test(v),
        'Use a local HTTPS scanner bridge',
      ),
    affidavitTemplate: z
      .string()
      .trim()
      .min(1)
      .max(5000)
      .refine((v) => !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v), 'Use plain text')
      .refine(
        (v) => [...v.matchAll(/\{\{(.*?)\}\}/g)].every((m) => AFFIDAVIT_FIELDS.includes(m[1])),
        'Unknown affidavit placeholder',
      ),
  })
  .strict();
export const renderAffidavit = (template, values) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(values[k] ?? ''));
export const listSchema = z
  .object({
    q: z.string().trim().max(100).default(''),
    field: z.enum(['all', 'name', 'cnic', 'phone', 'reference']).default('all'),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    status: z.enum(['all', 'active', 'void']).default('all'),
    cursor: z.string().max(2000).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'Start date must be before end date');
export const csvCell = (value) => {
  let s = String(value ?? '');
  if (/^\s*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
};
