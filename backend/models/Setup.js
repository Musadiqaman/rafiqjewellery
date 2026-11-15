import mongoose, { Schema } from 'mongoose';
export const Setup = mongoose.model(
  'Setup',
  new Schema({
    _id: String,
    initializedAt: Date,
    adminId: Schema.Types.ObjectId,
    operationId: String,
    status: { type: String, enum: ['pending', 'complete'] },
    payload: { type: Schema.Types.Mixed, select: false },
  }),
);
