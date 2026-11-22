import { auditEvent, tryFlushAudit, syncPendingAudits } from '../services/audit.js';
import mongoose, { Types } from 'mongoose';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { Settings, User, Audit } from '../models/index.js';
import { audit, HttpError } from '../middlewares/security.js';
import { settingsSchema, userSchema, roles } from '../validators/domain.js';

export const getSystem = async (_req, res) =>
  res.json({
    connected: mongoose.connection.readyState === 1,
    database: mongoose.connection.name,
    storage: 'MongoDB + encrypted GridFS',
  });

export const getSettings = async (req, res) => {
  const settings = await Settings.findById('shop').lean();
  if (req.user.role === 'cashier' && settings) {
    return res.json({
      shopName: settings.shopName,
      ratePaisa: settings.ratePaisa,
      receiptSize: settings.receiptSize,
      scannerUrl: settings.scannerUrl,
    });
  }
  res.json(settings);
};

export const patchSettings = async (req, res) => {
  const d = settingsSchema.parse(req.body),
    r = await Settings.findByIdAndUpdate('shop', { $set: d }, { new: true });
  await audit(req, 'settings.updated');
  res.json(r);
};

export const patchSettingsRate = async (req, res) => {
  const { ratePaisa } = z
    .object({ ratePaisa: z.number().int().min(100).max(1000000000) })
    .strict()
    .parse(req.body);
  const r = await Settings.findByIdAndUpdate(
    'shop',
    { $set: { ratePaisa, rateUpdatedAt: new Date(), rateUpdatedBy: req.user.name } },
    { new: true },
  );
  await audit(req, 'rate.updated', `PKR ${ratePaisa / 100} / tola`);
  res.json(r);
};

export const getUsers = async (_req, res) =>
  res.json(
    await User.find()
      .select('name email role active isPrimaryAdmin createdAt')
      .sort({ createdAt: 1 })
      .lean(),
  );

export const postUsers = async (req, res) => {
  const d = userSchema.parse(req.body),
    u = await User.create({
      name: d.name,
      email: d.email,
      role: d.role,
      passwordHash: await bcrypt.hash(d.password, 12),
    });
  await audit(req, 'user.created', `${u.name} (${u.role})`);
  res
    .status(201)
    .json({ id: String(u._id), name: u.name, email: u.email, role: u.role, active: u.active });
};

export const patchUsersId = async (req, res) => {
  const id = String(req.params.id),
    d = z
      .object({ role: z.enum(roles), active: z.boolean() })
      .strict()
      .parse(req.body);
  if (!Types.ObjectId.isValid(id)) throw new HttpError(404, 'User not found');
  if (id === String(req.user._id)) throw new HttpError(400, 'You cannot change your own access');
  const target = await User.findById(id);
  if (!target) throw new HttpError(404, 'User not found');
  if (target.isPrimaryAdmin)
    throw new HttpError(409, 'The primary administrator must stay active with admin access');
  const event = auditEvent(
    req,
    'user.access_changed',
    `${target.email}: ${d.role}, active=${d.active}`,
  );
  const u = await User.findOneAndUpdate(
    { _id: id, isPrimaryAdmin: { $ne: true } },
    {
      $set: { ...d, auditPending: true },
      $inc: { authVersion: 1 },
      $push: { auditEvents: event },
    },
    { new: true },
  );
  if (!u) throw new HttpError(409, 'The primary administrator cannot be changed');
  // Incrementing authVersion immediately invalidates previously issued access tokens.
  await tryFlushAudit(User, id);
  res.json({ id: String(u._id), role: u.role, active: u.active });
};

export const getAudit = async (req, res) => {
  await syncPendingAudits();
  const { before } = z
    .object({
      before: z
        .string()
        .regex(/^[a-f\d]{24}$/)
        .optional(),
    })
    .strict()
    .parse(req.query);
  const filter = {
    ...(before ? { _id: { $lt: new Types.ObjectId(before) } } : {}),
    ...(req.user.role === 'cashier' ? { actorId: req.user._id } : {}),
  };
  const rows = await Audit.find(filter)
    .sort({ _id: -1 })
    .limit(51)
    .lean();
  const more = rows.length > 50;
  if (more) rows.pop();
  res.json({ items: rows, nextCursor: more ? String(rows.at(-1)._id) : null });
};
