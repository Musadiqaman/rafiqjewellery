import mongoose, { Schema } from 'mongoose';

const { ObjectId, Mixed } = Schema.Types;
const opts = { timestamps: true, strict: 'throw' };
const media = new Schema(
  {
    fileId: ObjectId,
    createdBy: { type: ObjectId, index: true },
    recordId: { type: ObjectId, index: true },
    mime: String,
    size: Number,
    sha256: String,
    iv: String,
    tag: String,
    kind: String,
    source: String,
    expiresAt: Date,
  },
  opts,
);
media.index({ expiresAt: 1 });
export const Media = mongoose.model('Media', media);
