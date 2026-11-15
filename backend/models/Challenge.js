import mongoose, { Schema } from 'mongoose';

const { ObjectId, Mixed } = Schema.Types;
const opts = { timestamps: true, strict: 'throw' };
const challenge = new Schema(
  { _id: String, challenge: String, userId: ObjectId, type: String, expiresAt: Date },
  opts,
);
challenge.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const Challenge = mongoose.model('Challenge', challenge);
