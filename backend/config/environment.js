import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export const ENV_PATH = fileURLToPath(new URL('../.env', import.meta.url));

export function createEnvironmentFile(path = ENV_PATH) {
  if (existsSync(path)) return false;
  const secret = () => randomBytes(32).toString('hex');
  const content = [
    'NODE_ENV=development',
    'PORT=4000',
    'MONGODB_URI=mongodb://127.0.0.1:27017/rafiq_ledger',
    'APP_ORIGIN=http://localhost:5173',
    'RP_ID=localhost',
    `SESSION_SECRET=${secret()}`,
    `ENCRYPTION_KEY=${secret()}`,
    `SETUP_KEY=${secret()}`,
    'TRUST_PROXY=0',
    '',
  ].join('\n');
  try {
    writeFileSync(path, content, { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

const secret = (length) =>
  z
    .string()
    .min(length)
    .refine((v) => !v.startsWith('replace-with-'));
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().min(10),
  APP_ORIGIN: z.url(),
  RP_ID: z.string().min(1),
  SESSION_SECRET: secret(32),
  ENCRYPTION_KEY: z.string().regex(/^[a-f\d]{64}$/i),
  SETUP_KEY: secret(16),
  TRUST_PROXY: z.coerce.number().int().min(0).max(3).default(0),
});

export function validateEnvironment(values) {
  const result = schema.safeParse(values);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join('.')))];
    const error = new Error(
      `Invalid backend configuration: ${fields.join(', ')}. Check backend/.env. ` +
        'ENCRYPTION_KEY must contain exactly 64 hexadecimal characters. ' +
        'If you have saved images, restore the original key; do not generate a replacement. ' +
        'For a fresh installation, npm run setup creates a new .env only when it does not exist.',
    );
    error.code = 'CONFIG_INVALID';
    throw error;
  }
  if (result.data.NODE_ENV === 'production' && !result.data.APP_ORIGIN.startsWith('https://'))
    throw new Error('Production APP_ORIGIN requires HTTPS.');
  return result.data;
}
