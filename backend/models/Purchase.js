import mongoose, { Schema } from 'mongoose';

const { ObjectId, Mixed } = Schema.Types;
const opts = { timestamps: true, strict: 'throw' };
const purchase = new Schema(
  {
    reference: { type: String, unique: true, required: true },
    idempotencyKey: { type: String, unique: true, required: true },
    requestHash: String,
    state: { type: String, enum: ['pending', 'committed', 'failed'], default: 'committed' },
    failure: String,
    cleanupPending: { type: Boolean, default: false },
    evidenceIds: { type: [ObjectId], default: undefined },
    auditEvents: { type: [Mixed], default: [] },
    auditPending: { type: Boolean, default: false },
    purchasedAt: { type: Date, required: true },
    customer: {
      name: String,
      nameNormalized: String,
      namePrefixes: [String],
      cnic: String,
      phone: String,
    },
    weight: Mixed,
    grams: Number,
    tola: Number,
    ratePaisa: Number,
    grossPaisa: Number,
    totalPaisa: Number,
    items: [String],
    photoIds: [ObjectId],
    signatureId: ObjectId,
    thumbId: ObjectId,
    thumbSource: String,
    declarationText: String,
    shopSnapshot: Mixed,
    evidenceStatus: { type: String, enum: ['complete', 'incomplete'] },
    voided: { type: Boolean, default: false },
    voidReason: String,
    voidedAt: Date,
    voidedBy: ObjectId,
    deleted: { type: Boolean, default: false },
    deleteReason: String,
    deletedAt: Date,
    deletedBy: ObjectId,
    createdBy: ObjectId,
    createdByName: String,
  },
  opts,
);
for (const fields of [
  { purchasedAt: -1, _id: -1 },
  { 'customer.cnic': 1, purchasedAt: -1, _id: -1 },
  { 'customer.phone': 1, purchasedAt: -1, _id: -1 },
  { 'customer.namePrefixes': 1, purchasedAt: -1, _id: -1 },
  { evidenceStatus: 1, voided: 1, purchasedAt: -1, _id: -1 },
  { voided: 1, purchasedAt: -1, _id: -1 },
])
  purchase.index(fields);
purchase.index({ state: 1, createdAt: 1 });
purchase.index(
  { evidenceIds: 1 },
  {
    unique: true,
    partialFilterExpression: { state: 'committed', 'evidenceIds.0': { $exists: true } },
  },
);
export const Purchase = mongoose.model('Purchase', purchase);
