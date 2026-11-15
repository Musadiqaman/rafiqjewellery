import test from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1/unused',
  APP_ORIGIN: 'http://localhost:5173',
  RP_ID: 'localhost',
  SESSION_SECRET: 'standalone-test-session-secret-long-enough',
  ENCRYPTION_KEY: '4'.repeat(64),
  SETUP_KEY: 'standalone-test-setup-key',
});
const { Purchase, Media, Audit, User, Setup, Settings } = await import('../models/index.js');
const { finishPurchase, publicPurchase } = await import('../services/purchases.js');
const { finishSetup } = await import('../services/setup.js');
const { patchUsersId } = await import('../controllers/settings.controller.js');
const { requireAuth } = await import('../middlewares/security.js');
function query(value) {
  const p = Promise.resolve(value);
  p.select = () => p;
  p.lean = () => p;
  return p;
}
// Small datastore doubles allow deterministic crash injection. The separate
// integration suite exercises the same operations against real standalone MongoDB.
function purchaseFixture(t, options = {}) {
  const id = 'a'.repeat(24),
    mediaId = 'b'.repeat(24),
    events = new Map();
  const doc = {
    _id: id,
    state: 'pending',
    createdBy: 'c'.repeat(24),
    signatureId: mediaId,
    evidenceIds: [mediaId],
    auditPending: false,
    auditEvents: [{ eventKey: 'purchase:test:created', action: 'record.created' }],
  };
  const snapshot = () => ({ ...doc, auditEvents: [...doc.auditEvents] });
  let commits = 0;
  t.mock.method(Purchase, 'findById', () => query(snapshot()));
  t.mock.method(Purchase, 'exists', async (f) => (f.state === doc.state ? { _id: id } : null));
  t.mock.method(Purchase, 'findOneAndUpdate', async (filter, update) => {
    if (filter.state !== doc.state) return null;
    if (update.$set.state === 'committed') {
      if (options.failCommit) throw Error('Injected database interruption');
      commits++;
    }
    Object.assign(doc, update.$set);
    return snapshot();
  });
  t.mock.method(Purchase, 'updateOne', async (_filter, update) => {
    Object.assign(doc, update.$set);
    return { modifiedCount: 1 };
  });
  t.mock.method(Media, 'findOneAndUpdate', async () =>
    options.missingMedia ? null : { _id: mediaId },
  );
  t.mock.method(Media, 'updateMany', async () => ({ modifiedCount: 1 }));
  t.mock.method(Audit, 'updateOne', async (filter, update) => {
    if (options.failAudit) throw Error('Injected audit projection interruption');
    events.set(filter.eventKey, update.$setOnInsert);
    return { upsertedCount: 1 };
  });
  return { id, doc, events, options, commits: () => commits };
}
test('standalone concurrent retries commit a draft once and project one audit event', async (t) => {
  const f = purchaseFixture(t);
  const [a, b] = await Promise.all([finishPurchase(f.id), finishPurchase(f.id)]);
  assert.equal(a._id, b._id);
  assert.equal(f.commits(), 1);
  assert.equal(f.doc.state, 'committed');
  assert.equal(f.events.size, 1);
  assert.equal('auditEvents' in publicPurchase(a), false);
});
test('interrupted commit stays pending with its evidence reserved and resumes on retry', async (t) => {
  const f = purchaseFixture(t, { failCommit: true });
  await assert.rejects(finishPurchase(f.id), /Injected database interruption/);
  assert.equal(f.doc.state, 'pending');
  assert.equal(f.events.size, 0);
  assert.equal(Media.updateMany.mock.callCount(), 0);
  f.options.failCommit = false;
  assert.equal((await finishPurchase(f.id)).state, 'committed');
  assert.equal(f.events.size, 1);
});
test('invalid evidence cancels an invisible draft and releases only that draft claims', async (t) => {
  const f = purchaseFixture(t, { missingMedia: true });
  await assert.rejects(finishPurchase(f.id), (e) => e.status === 400 && e.resetSubmission === true);
  assert.equal(f.doc.state, 'failed');
  assert.equal(f.commits(), 0);
  assert.equal(f.events.size, 0);
  assert.deepEqual(Media.updateMany.mock.calls[0].arguments[0], { recordId: f.id });
});
test('audit projection failure preserves the committed bill and replays its durable event', async (t) => {
  const f = purchaseFixture(t, { failAudit: true });
  t.mock.method(console, 'error', () => {});
  assert.equal((await finishPurchase(f.id)).state, 'committed');
  assert.equal(f.doc.auditPending, true);
  assert.equal(f.events.size, 0);
  f.options.failAudit = false;
  await finishPurchase(f.id);
  assert.equal(f.commits(), 1);
  assert.equal(f.events.size, 1);
  assert.equal(f.doc.auditPending, false);
});
test('interrupted first-admin setup preserves the winning identity and can resume', async (t) => {
  const setup = {
    _id: 'initial-admin',
    adminId: 'd'.repeat(24),
    operationId: 'winner',
    status: 'pending',
    payload: {
      admin: {
        name: 'Original owner',
        email: 'owner@example.test',
        passwordHash: 'test-hash',
        role: 'admin',
      },
      shop: { shopName: 'Original shop' },
      event: { eventKey: 'installation.setup' },
    },
  };
  let fail = true,
    owner;
  t.mock.method(Setup, 'findById', () => query({ ...setup }));
  t.mock.method(Setup, 'updateOne', async (_f, u) => {
    Object.assign(setup, u.$set);
    if (u.$unset) delete setup.payload;
  });
  t.mock.method(Settings, 'updateOne', async () => {
    if (fail) throw Error('Injected configuration write interruption');
  });
  t.mock.method(User, 'updateOne', async (_f, u) => {
    owner = u.$setOnInsert;
  });
  t.mock.method(User, 'findById', () => query({ auditPending: false }));
  await assert.rejects(finishSetup(), /Injected configuration write/);
  assert.equal(setup.status, 'pending');
  assert.equal(owner, undefined);
  assert.ok(setup.payload);
  fail = false;
  await finishSetup();
  assert.equal(owner.email, 'owner@example.test');
  assert.equal(owner.isPrimaryAdmin, true);
  assert.equal(setup.status, 'complete');
  assert.equal(setup.payload, undefined);
});
test('primary administrator cannot be disabled or demoted on standalone MongoDB', async (t) => {
  t.mock.method(User, 'findById', async () => ({ isPrimaryAdmin: true }));
  const mutation = t.mock.method(User, 'findOneAndUpdate', async () => {
    throw Error('must not write');
  });
  await assert.rejects(
    patchUsersId(
      {
        params: { id: 'a'.repeat(24) },
        user: { _id: 'b'.repeat(24) },
        body: { role: 'viewer', active: false },
      },
      {},
    ),
    (e) => e.status === 409,
  );
  assert.equal(mutation.mock.callCount(), 0);
});
test('access tokens expire after 365 days and account version changes invalidate them', async (t) => {
  const { ACCESS_TOKEN_TTL_SECONDS, issueAccessToken, verifyAccessToken } = await import(
    '../utils/accessToken.js'
  );
  const now = Date.now();
  const issued = issueAccessToken({ _id: 'a'.repeat(24), authVersion: 0 }, now);
  const claims = verifyAccessToken(issued.token, now);
  assert.ok(claims);
  assert.equal(claims.exp - claims.iat, 365 * 24 * 60 * 60);
  assert.equal(ACCESS_TOKEN_TTL_SECONDS, 365 * 24 * 60 * 60);
  assert.equal(issued.expiresAt, claims.exp * 1000);
  assert.equal(verifyAccessToken(issued.token, now + (ACCESS_TOKEN_TTL_SECONDS + 1) * 1000), null);

  const lookup = t.mock.method(User, 'findOne', () => query(null));
  let rejected;
  await requireAuth(
    { headers: { authorization: `Bearer ${issued.token}` }, method: 'GET' },
    {},
    (error) => {
      rejected = error;
    },
  );
  assert.equal(rejected.status, 401);
  assert.equal(lookup.mock.callCount(), 1);
});
