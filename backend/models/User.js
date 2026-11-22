import mongoose, { Schema } from 'mongoose';

const { ObjectId, Mixed } = Schema.Types;
const opts = { timestamps: true, strict: 'throw' };
const user = new Schema(
  {
    name: String,
    email: { type: String, unique: true, required: true },
    passwordHash: { type: String, select: false, required: true },
    role: { type: String, enum: ['admin', 'cashier'], required: true },
    active: { type: Boolean, default: true },
    initialAdminKey: { type: String, unique: true, sparse: true },
    isPrimaryAdmin: { type: Boolean, default: false },
    authVersion: { type: Number, default: 0 },
    auditEvents: { type: [Mixed], default: [] },
    auditPending: { type: Boolean, default: false },
    passkeys: { type: [Mixed], default: [] },
  },
  opts,
);
export const User = mongoose.model('User', user);
