import mongoose, { Schema } from 'mongoose';

const { ObjectId, Mixed } = Schema.Types;
const opts = { timestamps: true, strict: 'throw' };
const bucket = new Schema({ _id: String, count: Number, expiresAt: Date });
bucket.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const RateBucket = mongoose.model('RateBucket', bucket);
