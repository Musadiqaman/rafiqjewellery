import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculate,
  GRAMS_PER_TOLA,
  entrySchema,
  weightFromGrams,
  can,
  namePrefixes,
  normalizeName,
  csvCell,
  loginSchema,
  settingsSchema,
  listSchema,
  formatCnic,
  formatCnicInput,
  renderAffidavit,
  DEFAULT_AFFIDAVIT,
} from '../src/lib/domain.js';
const fixture = () => ({
  weight: { mode: 'traditional', tola: 1, masha: 6, ratti: 0, grams: 0 },
  ratePaisa: 26000000,
  items: ['Ring'],
  customer: { name: 'Synthetic Seller', cnic: '00000-0000000-1', phone: '' },
  photoIds: [],
  signatureId: '123456789012345678901234',
  thumbId: null,
  thumbSource: null,
  idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
});
test('decimal 1.5 tola equals 1 tola 6 masha and costs Rs 390,000', () => {
  const d = fixture(),
    a = calculate(d.weight, d.ratePaisa),
    b = calculate({ ...d.weight, tola: 1.5, masha: 0 }, d.ratePaisa);
  assert.deepEqual(a, b);
  assert.equal(a.totalPaisa, 39000000);
  assert.equal(a.grams, 17.496);
});
test('grams preserve precision while deriving traditional units', () => {
  const w = weightFromGrams(GRAMS_PER_TOLA * 1.5);
  assert.equal(w.tola, 1);
  assert.equal(w.masha, 6);
  assert.equal(calculate(w, 26000000).totalPaisa, 39000000);
});
test('11.664 grams is exactly one tola and calculates the same amount', () => {
  const weight = weightFromGrams(11.664);
  assert.equal(weight.tola, 1);
  assert.equal(weight.masha, 0);
  assert.equal(weight.ratti, 0);
  assert.equal(calculate(weight, 41300000).tola, 1);
  assert.equal(calculate(weight, 41300000).totalPaisa, 41300000);
});
test('ratti converts to integer paisa', () =>
  assert.equal(
    calculate({ mode: 'traditional', tola: 0, masha: 0, ratti: 1, grams: 0 }, 26000000).totalPaisa,
    270833,
  ));
test('CNIC normalizes; CNIC, name and phone are optional', () => {
  const d = entrySchema.parse({
    ...fixture(),
    customer: { name: '', cnic: '00000-0000000-1', phone: '' },
  });
  assert.equal(d.customer.cnic, '0000000000001');
  assert.equal(d.customer.name, '');
  assert.ok(entrySchema.safeParse({ ...fixture(), customer: { cnic: '0000000000001' } }).success);
});
test('CNIC is optional but must be 13 digits when supplied; proof images are optional', () => {
  assert.equal(
    entrySchema.safeParse({ ...fixture(), customer: { name: '', cnic: '123', phone: '' } }).success,
    false,
  );
  assert.ok(
    entrySchema.safeParse({
      ...fixture(),
      customer: { name: '', cnic: '', phone: '' },
      signatureId: null,
      thumbId: null,
      thumbSource: null,
      photoIds: [],
    }).success,
  );
  assert.ok(
    entrySchema.safeParse({
      ...fixture(),
      signatureId: null,
      thumbId: '123456789012345678901235',
      thumbSource: 'camera',
    }).success,
  );
});
test('minimum purchase payload needs a valid gold quantity and system rate only', () => {
  const minimal = {
    weight: fixture().weight,
    ratePaisa: fixture().ratePaisa,
    idempotencyKey: fixture().idempotencyKey,
  };
  const parsed = entrySchema.safeParse(minimal);
  assert.ok(parsed.success);
  assert.deepEqual(parsed.data.items, []);
  assert.deepEqual(parsed.data.customer, { name: '', cnic: '', phone: '' });
  assert.deepEqual(parsed.data.photoIds, []);
  assert.equal(parsed.data.signatureId, null);
  assert.equal(parsed.data.thumbId, null);
});
test('removed fields and client-controlled timestamps/totals are rejected', () => {
  for (const field of [
    'purchasedAt',
    'deductionPaisa',
    'purity',
    'payment',
    'notes',
    'totalPaisa',
    'consent',
    'declarationAccepted',
  ])
    assert.equal(entrySchema.safeParse({ ...fixture(), [field]: 1 }).success, false);
});
test('invalid weights and Mongo operators are rejected', () => {
  for (const patch of [
    { masha: 12 },
    { ratti: 8 },
    { tola: -1 },
    { tola: 0, masha: 0, ratti: 0 },
    { mode: 'grams', grams: Infinity },
  ])
    assert.equal(
      entrySchema.safeParse({ ...fixture(), weight: { ...fixture().weight, ...patch } }).success,
      false,
    );
  assert.equal(entrySchema.safeParse({ ...fixture(), customer: { $ne: null } }).success, false);
});
test('HTML, invalid phone and excess photos are rejected', () => {
  for (const patch of [
    { customer: { ...fixture().customer, name: '<script>' } },
    { customer: { ...fixture().customer, phone: 'abc' } },
    { photoIds: Array(9).fill('123456789012345678901234') },
  ])
    assert.equal(entrySchema.safeParse({ ...fixture(), ...patch }).success, false);
});
test('permissions protect manager, cashier and viewer boundaries', () => {
  assert.equal(can('viewer', 'create'), false);
  assert.equal(can('cashier', 'export'), false);
  assert.equal(can('cashier', 'rate'), false);
  assert.equal(can('manager', 'users'), false);
  assert.equal(can('manager', 'delete'), true);
  assert.equal(can('cashier', 'delete'), false);
  assert.equal(can('manager', 'void'), true);
  assert.equal(can('admin', 'settings'), true);
});
test('name prefixes include full name and surname', () => {
  assert.equal(normalizeName('  AHMED  Raza '), 'ahmed raza');
  assert.ok(namePrefixes('Ahmed Raza').includes('raz'));
  assert.ok(namePrefixes('Ahmed Raza').includes('ahmed ra'));
});
test('CSV formula and quote escaping', () => {
  assert.equal(csvCell('=SUM(A1)'), '"\'=SUM(A1)"');
  assert.equal(csvCell(' x"y\nz'), '" x""y\nz"');
  assert.equal(csvCell(' @sum'), '"\' @sum"');
});
test('password limits use UTF-8 bytes', () => {
  assert.equal(
    loginSchema.safeParse({ email: 'a@example.test', password: '\u00e9'.repeat(37) }).success,
    false,
  );
  assert.ok(loginSchema.safeParse({ email: 'a@example.test', password: '123456' }).success);
  assert.equal(loginSchema.safeParse({ email: 'a@example.test', password: '12345' }).success, false);
  assert.ok(
    loginSchema.safeParse({ email: 'a@example.test', password: 'long-enough-test-password' })
      .success,
  );
});
const settings = {
  shopName: 'Shop',
  address: '',
  phone: '',
  receiptSize: 'a4',
  scannerUrl: '',
  affidavitTemplate: DEFAULT_AFFIDAVIT,
};
test('scanner bridge accepts local HTTPS only', () => {
  for (const url of [
    'http://localhost:8443',
    'https://evil.test',
    'https://localhost.evil.test:8443',
    'https://localhost:8443/capture',
  ])
    assert.equal(settingsSchema.safeParse({ ...settings, scannerUrl: url }).success, false);
  assert.ok(
    settingsSchema.safeParse({ ...settings, scannerUrl: 'https://localhost:8443' }).success,
  );
});
test('affidavit template allows documented placeholders and plain text only', () => {
  assert.equal(
    renderAffidavit('{{name}} | {{cnic}}', { name: 'Seller', cnic: '000' }),
    'Seller | 000',
  );
  assert.ok(settingsSchema.safeParse(settings).success);
  for (const text of ['{{unknown}}', '<script>', ''])
    assert.equal(settingsSchema.safeParse({ ...settings, affidavitTemplate: text }).success, false);
});
test('search rejects raw operators, arrays, impossible dates, excessive limits', () => {
  for (const query of [
    { q: { $ne: '' } },
    { q: ['a', 'b'] },
    { from: '2026-02-31' },
    { from: '2026-11-14', to: '2026-11-12' },
    { limit: 500 },
    { $where: 'true' },
  ])
    assert.equal(listSchema.safeParse(query).success, false);
});
test('phone is an accepted search field', () => {
  assert.ok(listSchema.safeParse({ field: 'phone' }).success);
});
test('CNIC formatting keeps digits', () =>
  assert.equal(formatCnic('0000000000001'), '00000-0000000-1'));
test('CNIC input adds Pakistani separators and limits input to 13 digits', () => {
  assert.equal(formatCnicInput('12345'), '12345');
  assert.equal(formatCnicInput('1234567'), '12345-67');
  assert.equal(formatCnicInput('1234567890123'), '12345-6789012-3');
  assert.equal(formatCnicInput('1234567890123456'), '12345-6789012-3');
});

test('quick increments preserve fractional tola and carry 12 masha', async () => {
  const { incrementWeight } = await import('../src/lib/domain.js');
  const w = { mode: 'traditional', tola: 1.51, masha: 11, ratti: 3, grams: 0 };
  const added = incrementWeight(w, 'masha');
  assert.equal(added.tola, 2.51);
  assert.equal(added.masha, 0);
  assert.equal(added.ratti, 3);
  assert.ok(Math.abs(calculate(added, 100).tola - calculate(w, 100).tola - 1 / 12) < 1e-12);
  const grams = weightFromGrams(13.123456);
  assert.ok(
    Math.abs(incrementWeight(grams, 'tola').grams - 13.123456 - GRAMS_PER_TOLA / 2) < 1e-12,
  );
});
test('gram display rounding carries ratti without invalid 8-ratti fields', () => {
  const grams = GRAMS_PER_TOLA * (1 - 0.000001);
  const w = weightFromGrams(grams);
  assert.equal(w.tola, 1);
  assert.equal(w.masha, 0);
  assert.equal(w.ratti, 0);
  assert.equal(w.grams, grams);
  assert.ok(entrySchema.safeParse({ ...fixture(), weight: w }).success);
});
