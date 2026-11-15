import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import { Setup, Settings, User } from '../models/index.js';
import { HttpError } from '../middlewares/security.js';
import { auditEvent, tryFlushAudit } from './audit.js';

async function insertOnce(model, filter, values) {
  try {
    await model.updateOne(filter, { $setOnInsert: values }, { upsert: true });
  } catch (error) {
    if (error.code !== 11000 || !(await model.exists(filter))) throw error;
  }
}

export async function finishSetup() {
  const setup = await Setup.findById('initial-admin').select('+payload').lean();
  if (!setup?.payload || setup.status !== 'pending') return;
  const { admin, shop, event } = setup.payload;
  await insertOnce(Settings, { _id: 'shop' }, shop);
  await insertOnce(
    User,
    { _id: setup.adminId },
    {
      ...admin,
      initialAdminKey: 'initial-admin',
      isPrimaryAdmin: true,
      auditEvents: [event],
      auditPending: true,
    },
  );
  await Setup.updateOne(
    { _id: setup._id, operationId: setup.operationId },
    {
      $set: { status: 'complete', initializedAt: new Date() },
      $unset: { payload: 1 },
    },
  );
  await tryFlushAudit(User, setup.adminId);
}

export async function createInitialAdmin(d, req) {
  await finishSetup();
  if (await User.exists({ role: 'admin' })) throw new HttpError(409, 'Setup already complete');
  const operationId = randomUUID(),
    adminId = new Types.ObjectId();
  const event = auditEvent(
    { ...req, user: { _id: adminId, name: d.name } },
    'installation.setup',
    'Initial administrator created',
    undefined,
    'installation.setup',
  );
  try {
    await Setup.create({
      _id: 'initial-admin',
      operationId,
      adminId,
      status: 'pending',
      payload: {
        admin: {
          name: d.name,
          email: d.email,
          passwordHash: await bcrypt.hash(d.password, 12),
          role: 'admin',
        },
        shop: {
          shopName: d.shopName,
          ratePaisa: 26000000,
          rateUpdatedAt: new Date(),
          rateUpdatedBy: d.name,
        },
        event,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      await finishSetup();
      throw new HttpError(409, 'Setup already complete');
    }
    throw error;
  }
  await finishSetup();
  return User.findById(adminId);
}

export async function protectPrimaryAdmin() {
  if (await User.exists({ isPrimaryAdmin: true, active: true, role: 'admin' })) return;
  // Existing version 2.1 installations are kept usable without recreating users.
  const first = await User.findOne({ role: 'admin', active: true }).sort({ createdAt: 1, _id: 1 });
  if (first) await User.updateOne({ _id: first._id }, { $set: { isPrimaryAdmin: true } });
}
