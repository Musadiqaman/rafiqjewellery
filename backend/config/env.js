import { existsSync } from 'node:fs';
import { ENV_PATH, validateEnvironment } from './environment.js';
if (existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);
export const env = validateEnvironment(process.env);
export const CHALLENGE_COOKIE =
  env.NODE_ENV === 'production' ? '__Host-rj_challenge' : 'rj_challenge';
export const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
};
