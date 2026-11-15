import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import sharp from 'sharp';
import mongoose from 'mongoose';
const mongo = process.env.MONGODB_URI_TEST;
test(
  'MongoDB integration: authentication, evidence, phone search, void and reasoned delete',
  {
    skip: !mongo ? 'Set MONGODB_URI_TEST to an isolated test database to run.' : false,
    timeout: 90000,
  },
  async () => {
    const uri = new URL(mongo);
    uri.pathname = '/rafiq_test_' + randomUUID().replaceAll('-', '');
    Object.assign(process.env, {
      NODE_ENV: 'test',
      MONGODB_URI: uri.href,
      APP_ORIGIN: 'http://ledger.test',
      RP_ID: 'ledger.test',
      SESSION_SECRET: 'isolated-test-session-secret-at-least-32',
      ENCRYPTION_KEY: '3'.repeat(64),
      SETUP_KEY: 'isolated-test-setup-key',
    });
    const { Purchase, Audit, User, Media, Setup, Settings } = await import('../models/index.js');
    const { connectDatabase } = await import('../config/db.js');
    const { app } = await import('../app.js');
    await connectDatabase(uri.href);
    for (const model of Object.values(mongoose.models)) await model.createIndexes();
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address(),
      base = `http://127.0.0.1:${address.port}/api`;
    let token = '';
    async function request(path, method = 'GET', data, accessToken = token) {
      const response = await fetch(base + path, {
        method,
        headers: {
          Origin: 'http://ledger.test',
          ...(data ? { 'Content-Type': 'application/json' } : {}),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: data ? JSON.stringify(data) : undefined,
      });
      return { status: response.status, headers: response.headers, body: await response.json() };
    }
    try {
      assert.equal((await request('/auth/status')).body.setupRequired, true);
      assert.equal((await request('/records')).status, 401);
      const admin = {
        name: 'QA Admin',
        shopName: 'Test Shop',
        email: 'admin@example.test',
        password: 'qa-only-strong-password',
        setupKey: 'isolated-test-setup-key',
      };
      const setup = await Promise.all([
        request('/auth/setup', 'POST', admin),
        request('/auth/setup', 'POST', admin),
      ]);
      assert.deepEqual(setup.map((r) => r.status).sort(), [201, 409]);
      const winner = setup.find((r) => r.status === 201);
      token = winner.body.token;
      assert.ok(token);
      assert.equal(winner.headers.get('set-cookie'), null);
      assert.equal(await mongoose.connection.db.collection('sessions').countDocuments(), 0);
      assert.equal((await request('/auth/status')).body.setupRequired, false);
      assert.equal((await request('/auth/setup', 'POST', admin)).status, 409);
      const forgedToken = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
      assert.equal((await request('/records', 'GET', undefined, forgedToken)).status, 401);
      for (const role of ['cashier', 'viewer'])
        assert.equal(
          (
            await request('/users', 'POST', {
              name: 'QA ' + role,
              email: role + '@example.test',
              password: 'qa-only-strong-password',
              role,
            })
          ).status,
          201,
        );
      const cashier = await request('/auth/login', 'POST', {
        email: 'cashier@example.test',
        password: 'qa-only-strong-password',
      });
      const cashierToken = cashier.body.token;
      assert.ok(cashierToken);
      assert.equal(await mongoose.connection.db.collection('sessions').countDocuments(), 0);
      assert.equal(
        (await request('/settings/rate', 'PATCH', { ratePaisa: 1 }, cashierToken)).status,
        403,
      );
      assert.equal((await request('/users', 'GET', undefined, cashierToken)).status, 403);
      const image = await sharp({
          create: { width: 20, height: 20, channels: 3, background: '#332211' },
        })
          .png()
          .toBuffer(),
        form = new FormData();
      form.set('file', new Blob([Uint8Array.from(image)], { type: 'image/png' }), 'synthetic.png');
      form.set('kind', 'signature');
      form.set('source', 'signature');
      const uploaded = await fetch(base + '/media', {
        method: 'POST',
        headers: { Origin: 'http://ledger.test', Authorization: `Bearer ${token}` },
        body: form,
      });
      assert.equal(uploaded.status, 201);
      const file = await uploaded.json();
      assert.equal(file.sha256, createHash('sha256').update(image).digest('hex'));
      const entry = {
        weight: { mode: 'traditional', tola: 1, masha: 6, ratti: 0, grams: 0 },
        ratePaisa: 26000000,
        items: ['Ring'],
        customer: {
          name: 'Test Seller',
          cnic: '0000000000099',
          phone: '030239428347',
        },
        photoIds: [],
        signatureId: file.id,
        thumbId: null,
        thumbSource: null,
        idempotencyKey: randomUUID(),
      };
      const created = await Promise.all([
        request('/records', 'POST', entry),
        request('/records', 'POST', entry),
      ]);
      assert.ok(
        created.every((r) => r.status === 201 || r.status === 200),
        JSON.stringify(created),
      );
      assert.equal(created[0].body._id, created[1].body._id);
      assert.equal(created[0].body.totalPaisa, 39000000);
      assert.equal(await Purchase.countDocuments(), 1);
      assert.ok(Math.abs(Date.now() - Date.parse(created[0].body.purchasedAt)) < 10000);
      assert.equal('consent' in created[0].body, false);
      assert.equal(
        (await request('/records', 'POST', { ...entry, purchasedAt: '2000-01-01T00:00:00Z' }))
          .status,
        400,
      );
      const dashboard = await request('/dashboard');
      assert.equal(dashboard.body.stats.count, 1);
      assert.equal(dashboard.body.items.length, 1);
      assert.equal((await request('/dashboard?from=2000-01-01&to=2000-01-01')).body.stats.count, 0);
      assert.equal((await request('/dashboard?q=0000000000099')).body.stats.amount, 39000000);
      const beforeSettings = (await request('/settings')).body;
      const template =
        'Seller {{name}}, CNIC {{cnic}}; sold {{weight}} to {{shop}} for {{amount}}.';
      assert.equal(
        (
          await request('/settings', 'PATCH', {
            shopName: beforeSettings.shopName,
            address: '',
            phone: '',
            receiptSize: 'a4',
            scannerUrl: '',
            affidavitTemplate: template,
          })
        ).status,
        200,
      );
      assert.equal(
        (await Purchase.findById(created[0].body._id)).declarationText,
        created[0].body.declarationText,
      );
      assert.equal((await request('/system')).body.database, uri.pathname.slice(1));

      assert.equal(
        (await request('/records', 'POST', { ...entry, ratePaisa: 27000000 })).status,
        409,
      );
      const id = created[0].body._id,
        read = await request('/records/' + id);
      assert.equal(read.body.media[0].sha256, file.sha256);
      const original = await fetch(base + '/media/' + file.id, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.deepEqual(Buffer.from(await original.arrayBuffer()), image);
      assert.equal((await request('/records?q=0000000000099&field=cnic')).body.items.length, 1);
      assert.equal((await request('/records?q=sell&field=name')).body.items.length, 1);
      assert.equal((await request('/records?q=0302')).body.items.length, 1);
      assert.equal((await request('/records?q=030239&field=phone')).body.items.length, 1);
      assert.equal((await request('/records?q%5B%24ne%5D=x')).status, 400);
      const viewer = await request('/auth/login', 'POST', {
        email: 'viewer@example.test',
        password: 'qa-only-strong-password',
      });
      assert.equal(
        (
          await request('/records', 'POST', entry, viewer.body.token)
        ).status,
        403,
      );
      assert.equal(
        (
          await request('/records/' + id + '/void', 'POST', {
            reason: 'Synthetic correction for QA',
          })
        ).status,
        200,
      );
      assert.equal((await request('/dashboard')).body.stats.count, 0);
      assert.equal((await request('/records/' + id)).body.voided, true);
      assert.ok(await Audit.exists({ action: 'record.voided' }));

      const deleteEntry = {
        ...entry,
        customer: { ...entry.customer, phone: '03005551234' },
        idempotencyKey: randomUUID(),
      };
      const deleteCreated = await request('/records', 'POST', deleteEntry);
      assert.equal(deleteCreated.status, 201);
      const deleteId = deleteCreated.body._id;
      assert.equal((await request('/records?q=0300')).body.items.length, 1);
      assert.equal(
        (
          await request(
            '/records/' + deleteId + '/delete',
            'POST',
            { reason: 'Duplicate purchase entered in error' },
            cashierToken,
          )
        ).status,
        403,
      );
      const deleted = await request('/records/' + deleteId + '/delete', 'POST', {
        reason: 'Duplicate purchase entered in error',
      });
      assert.equal(deleted.status, 200);
      assert.equal(deleted.body.deleted, true);
      const retained = await Purchase.findById(deleteId).lean();
      assert.equal(retained.deleted, true);
      assert.equal(retained.deleteReason, 'Duplicate purchase entered in error');
      assert.ok(retained.deletedAt);
      assert.equal((await request('/records?q=0300')).body.items.length, 0);
      assert.equal((await request('/dashboard')).body.stats.count, 0);
      assert.equal((await request('/records/' + deleteId)).status, 404);
      assert.ok(
        await Audit.exists({
          action: 'record.deleted',
          detail: 'Duplicate purchase entered in error',
        }),
      );

      // Standalone write recovery: an interrupted claim leaves an invisible draft,
      // and an identical retry completes that draft instead of creating another bill.
      const { saveMedia, cleanUploads } = await import('../services/media.js');
      const owner = await User.findOne({ email: admin.email });
      const recoveryImage = await saveMedia(image, owner._id, 'signature', 'signature');
      const recoveryEntry = {
        ...entry,
        signatureId: String(recoveryImage._id),
        idempotencyKey: randomUUID(),
      };
      const originalClaim = Media.findOneAndUpdate;
      Media.findOneAndUpdate = async () => {
        throw Error('Injected interrupted evidence claim');
      };
      try {
        assert.equal((await request('/records', 'POST', recoveryEntry)).status, 500);
      } finally {
        Media.findOneAndUpdate = originalClaim;
      }
      const pending = await Purchase.findOne({ idempotencyKey: recoveryEntry.idempotencyKey });
      assert.equal(pending.state, 'pending');
      assert.equal((await request('/records/' + pending._id)).status, 404);
      assert.equal((await request('/dashboard')).body.stats.count, 0);
      const resumed = await request('/records', 'POST', recoveryEntry);
      assert.equal(resumed.status, 200);
      assert.equal(resumed.body._id, String(pending._id));
      assert.equal(
        await Purchase.countDocuments({ idempotencyKey: recoveryEntry.idempotencyKey }),
        1,
      );
      assert.equal((await Purchase.findById(pending._id)).state, 'committed');
      assert.equal(await Audit.countDocuments({ eventKey: `purchase:${pending._id}:created` }), 1);
      // A delayed retention-metadata update must never delete evidence of a saved bill.
      await Media.updateOne({ _id: recoveryImage._id }, { $set: { expiresAt: new Date(0) } });
      await cleanUploads();
      assert.ok(await Media.exists({ _id: recoveryImage._id }));
      assert.equal((await Media.findById(recoveryImage._id)).expiresAt, undefined);
      const reused = await request('/records', 'POST', {
        ...recoveryEntry,
        idempotencyKey: randomUUID(),
      });
      assert.equal(reused.status, 400);
      assert.equal(reused.body.resetSubmission, true);
      assert.equal((await request('/dashboard')).body.stats.count, 1);
      assert.equal(
        (
          await request('/records/' + pending._id + '/void', 'POST', {
            reason: 'Recovery test correction',
          })
        ).status,
        200,
      );
      // The primary administrator remains active even when another admin changes access.
      await request('/users', 'POST', {
        name: 'Second admin',
        email: 'second@example.test',
        password: 'qa-only-strong-password',
        role: 'admin',
      });
      const secondary = await request('/auth/login', 'POST', {
        email: 'second@example.test',
        password: 'qa-only-strong-password',
      });
      const secondaryToken = secondary.body.token;
      assert.equal(
        (
          await request(
            '/users/' + owner._id,
            'PATCH',
            { role: 'viewer', active: false },
            secondaryToken,
          )
        ).status,
        409,
      );
      const cashierUser = await User.findOne({ email: 'cashier@example.test' });
      assert.equal(
        (await request('/users/' + cashierUser._id, 'PATCH', { role: 'viewer', active: false }))
          .status,
        200,
      );
      assert.equal((await request('/auth/me', 'GET', undefined, cashierToken)).status, 401);
      // Populate more than one page to verify the real Mongo cursor, stable order and no overlap.
      const stamp = new Date();
      await Purchase.insertMany(
        Array.from({ length: 31 }, (_, i) => ({
          reference: 'QA-' + i,
          idempotencyKey: randomUUID(),
          purchasedAt: stamp,
          customer: {
            name: 'Pager',
            cnic: '0000000000000',
            namePrefixes: ['p', 'pa', 'pag', 'page', 'pager'],
          },
          items: ['Gold'],
          grams: 1,
          tola: 0.1,
          totalPaisa: 100,
          ratePaisa: 1000,
          evidenceStatus: 'complete',
          voided: false,
        })),
      );
      const first = (await request('/records?status=active&q=pager')).body;
      assert.equal(first.items.length, 25);
      assert.ok(first.nextCursor);
      const second = (
        await request(
          '/records?status=active&q=pager&cursor=' + encodeURIComponent(first.nextCursor),
        )
      ).body;
      assert.equal(second.items.length, 6);
      assert.equal(second.nextCursor, null);
      assert.equal(new Set([...first.items, ...second.items].map((x) => x._id)).size, 31);
      assert.equal((await request('/records?status=void')).body.items.length, 2);
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
