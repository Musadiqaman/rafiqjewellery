import test from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1/test',
  APP_ORIGIN: 'https://ledger.example.test',
  RP_ID: 'ledger.example.test',
  SESSION_SECRET: 'test-only-secret-at-least-32-characters',
  ENCRYPTION_KEY: '1'.repeat(64),
  SETUP_KEY: 'test-installation-key',
});
const { buildQuery } = await import('../services/query.js');
const { originGuard, allow } = await import('../middlewares/security.js');
test('date range uses Pakistan midnight and an exclusive next-day boundary', () => {
  const q = buildQuery({ from: '2026-11-12', to: '2026-11-12' });
  const d = q.filter.$and[0].purchasedAt;
  assert.equal(d.$gte.toISOString(), '2026-11-11T19:00:00.000Z');
  assert.equal(d.$lt.toISOString(), '2026-11-12T19:00:00.000Z');
});
test('CNIC search is indexed equality, not an unbounded regex', () => {
  const q = buildQuery({ q: '00000-0000000-1', field: 'all' });
  assert.deepEqual(
    q.filter.$and.find((c) => 'customer.cnic' in c),
    { 'customer.cnic': '0000000000001' },
  );
});
test('partial CNIC search matches an indexed prefix from the first two digits', () => {
  const q = buildQuery({ q: '42', field: 'all' });
  assert.deepEqual(
    q.filter.$and.find((c) => 'customer.cnic' in c),
    { 'customer.cnic': { $regex: '^42' } },
  );
});
test('formatted partial CNIC search normalizes separators before prefix matching', () => {
  const q = buildQuery({ q: '42101-23', field: 'all' });
  assert.deepEqual(
    q.filter.$and.find((c) => 'customer.cnic' in c),
    { 'customer.cnic': { $regex: '^4210123' } },
  );
});
test('Pakistani mobile prefixes search phone numbers with local and international formats', () => {
  const local = buildQuery({ q: '0302', field: 'all' }).filter.$and.find((c) => c.$or);
  assert.ok(local);
  assert.ok(local.$or.some((c) => new RegExp(c['customer.phone'].$regex).test('0302')));
  assert.ok(local.$or.some((c) => new RegExp(c['customer.phone'].$regex).test('+92302')));

  const international = buildQuery({ q: '+92302', field: 'all' }).filter.$and.find((c) => c.$or);
  assert.ok(international);
  assert.ok(international.$or.some((c) => new RegExp(c['customer.phone'].$regex).test('0302')));
  assert.ok(buildQuery({ q: '0302', field: 'phone' }).filter.$and.some((c) => c.$or));
});

test('reference query escapes regular expression syntax', () => {
  assert.deepEqual(
    buildQuery({ q: 'RJ-.*', field: 'reference' }).filter.$and.find((c) => c.reference),
    { reference: { $regex: '^RJ-\\.\\*' } },
  );
});
test('weight search accepts decimal grams and an explicit gram suffix', () => {
  const decimal = buildQuery({ q: '11.664' }).filter.$and.find((c) => c.grams);
  assert.ok(decimal);
  assert.ok(Math.abs(decimal.grams.$gte - 11.6635) < 1e-10);
  assert.ok(Math.abs(decimal.grams.$lt - 11.6645) < 1e-10);
  const suffix = buildQuery({ q: '17.5 g' }).filter.$and.find((c) => c.grams);
  assert.ok(suffix);
  assert.ok(Math.abs(suffix.grams.$gte - 17.45) < 1e-10);
  assert.ok(Math.abs(suffix.grams.$lt - 17.55) < 1e-10);
  const tola = buildQuery({ q: '1 tola' }).filter.$and.find((c) => c.tola);
  assert.deepEqual(tola, { tola: { $gte: 0.5, $lt: 1.5 } });
  assert.throws(() => buildQuery({ q: 'not-a-weight', field: 'weight' }), /weight in grams or tola/i);
});

test('weight search accepts a full displayed grams-and-tola value and matches either unit', () => {
  const query = buildQuery({ q: '1.0000 tola · 11.664 g' }),
    weightClause = query.filter.$and.find((clause) => clause.$or);
  assert.ok(weightClause);
  assert.equal(weightClause.$or.length, 2);
  assert.deepEqual(weightClause.$or[0], { tola: { $gte: 0.99995, $lt: 1.00005 } });
  assert.ok(Math.abs(weightClause.$or[1].grams.$gte - 11.6635) < 1e-10);
  assert.ok(Math.abs(weightClause.$or[1].grams.$lt - 11.6645) < 1e-10);
});

test('weight-only search accepts whole-number grams when the weight field is selected', () => {
  const grams = buildQuery({ q: '12', field: 'weight' }).filter.$and.find((clause) => clause.grams);
  assert.deepEqual(grams, { grams: { $gte: 11.5, $lt: 12.5 } });
});
test('cursor uses date plus ID and rejects tampering, extra segments or different filters', () => {
  const row = { _id: '123456789012345678901234', purchasedAt: new Date('2026-11-12T01:00:00Z') },
    q = buildQuery({ q: 'ahmed' }),
    cursor = q.cursor(row);
  const pagination = buildQuery({ q: 'ahmed', cursor }).filter.$and.find((c) => c.$or);
  assert.equal(pagination.$or[1]._id.$lt.toString(), row._id);
  for (const input of [
    { q: 'hassan', cursor },
    { q: 'ahmed', cursor: cursor + 'x' },
    { q: 'ahmed', cursor: cursor + '.ignored' },
    { q: 'ahmed', cursor: 'not-a-cursor' },
  ])
    assert.throws(() => buildQuery(input), /Invalid page cursor/);
});
test('unsafe methods require the exact application origin', () => {
  for (const origin of [undefined, 'https://evil.test', 'https://ledger.example.test.evil.test']) {
    let error;
    originGuard({ method: 'POST', get: () => origin }, { setHeader: () => {} }, (e) => {
      error = e;
    });
    assert.equal(error.status, 403);
  }
  let error;
  originGuard(
    { method: 'POST', get: () => 'https://ledger.example.test' },
    { setHeader: () => {} },
    (e) => {
      error = e;
    },
  );
  assert.equal(error, undefined);
});
test('server authorization blocks forbidden mutations', () => {
  let error;
  allow('users')({ user: { role: 'cashier' } }, {}, (e) => {
    error = e;
  });
  assert.equal(error.status, 403);
  allow('create')({ user: { role: 'cashier' } }, {}, (e) => {
    error = e;
  });
  assert.equal(error, undefined);
  error = undefined;
  allow('delete')({ user: { role: 'manager' } }, {}, (e) => {
    error = e;
  });
  assert.equal(error.status, 403);
  error = undefined;
  allow('delete')({ user: { role: 'cashier' } }, {}, (e) => {
    error = e;
  });
  assert.equal(error.status, 403);
  error = undefined;
  allow('receipt')({ user: { role: 'cashier' } }, {}, (e) => {
    error = e;
  });
  assert.equal(error, undefined);
  allow('activity')({ user: { role: 'cashier' } }, {}, (e) => {
    error = e;
  });
  assert.equal(error, undefined);
  allow('password')({ user: { role: 'cashier' } }, {}, (e) => {
    error = e;
  });
  assert.equal(error.status, 403);
});

test('pending and failed bills are excluded from every search and aggregate base', () => {
  for (const input of [{}, { q: 'ahmed' }, { status: 'void' }]) {
    const query = buildQuery(input);
    assert.deepEqual(
      query.base.$and.find((c) => c.state),
      { state: { $nin: ['pending', 'failed'] } },
    );
    assert.deepEqual(
      query.filter.$and.find((c) => c.state),
      { state: { $nin: ['pending', 'failed'] } },
    );
    assert.deepEqual(query.base.$and.find((c) => c.deleted), { deleted: { $ne: true } });
    assert.deepEqual(query.filter.$and.find((c) => c.deleted), { deleted: { $ne: true } });
  }
});
const { localCompatibleUri } = await import('../config/db.js');
test('legacy loopback development URI works on standalone without changing remote or production settings', () => {
  const local = 'mongodb://127.0.0.1:27017/rafiq_ledger?replicaSet=rs0';
  assert.equal(localCompatibleUri(local, 'development'), 'mongodb://127.0.0.1:27017/rafiq_ledger');
  assert.equal(localCompatibleUri(local, 'production'), local);
  const remote = 'mongodb://database.example.test/rafiq_ledger?replicaSet=rs0';
  assert.equal(localCompatibleUri(remote, 'development'), remote);
  const atlas = 'mongodb+srv://example.mongodb.net/rafiq_ledger?replicaSet=atlas-set';
  assert.equal(localCompatibleUri(atlas, 'development'), atlas);
});
