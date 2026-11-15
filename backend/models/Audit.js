import mongoose, { Schema } from 'mongoose';

const { ObjectId, Mixed } = Schema.Types;
const opts = { timestamps: true, strict: 'throw' };
const audit = new Schema(
  {
    actorId: ObjectId,
    eventKey: { type: String, unique: true, sparse: true },
    actorName: String,
    action: String,
    recordId: ObjectId,
    detail: String,
    requestId: String,
  },
  opts,
);
// MongoDB's built-in _id index also supports the audit feed's descending scan.
export const Audit = mongoose.model('Audit', audit);
