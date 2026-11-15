import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { createEnvironmentFile, validateEnvironment } from '../config/environment.js';

test('fresh setup creates valid independent secrets without printing them', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'rafiq-setup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, '.env');
  assert.equal(createEnvironmentFile(path), true);
  const values = validateEnvironment(parseEnv(readFileSync(path, 'utf8')));
  assert.match(values.ENCRYPTION_KEY, /^[a-f0-9]{64}$/);
  assert.equal(values.MONGODB_URI, 'mongodb://127.0.0.1:27017/rafiq_ledger');
  assert.equal(new Set([values.SESSION_SECRET, values.ENCRYPTION_KEY, values.SETUP_KEY]).size, 3);
  const original = readFileSync(path, 'utf8');
  assert.equal(createEnvironmentFile(path), false);
  assert.equal(readFileSync(path, 'utf8'), original);
});

test('setup never replaces an existing environment, even when validation fails', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'rafiq-existing-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, '.env');
  const original = 'ENCRYPTION_KEY=existing-important-key\n';
  writeFileSync(path, original);
  assert.equal(createEnvironmentFile(path), false);
  assert.equal(readFileSync(path, 'utf8'), original);
});

test('invalid config reports the field and recovery action without exposing its value', () => {
  assert.throws(
    () => validateEnvironment({ ENCRYPTION_KEY: 'private-do-not-log' }),
    (error) => {
      assert.equal(error.code, 'CONFIG_INVALID');
      assert.match(error.message, /ENCRYPTION_KEY/);
      assert.match(error.message, /restore the original key/);
      assert.equal(error.message.includes('private-do-not-log'), false);
      return true;
    },
  );
});
