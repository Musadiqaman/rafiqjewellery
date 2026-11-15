import mongoose, { Schema } from 'mongoose';
import { DEFAULT_AFFIDAVIT } from '../validators/domain.js';
const { ObjectId, Mixed } = Schema.Types;
const opts = { timestamps: true, strict: 'throw' };
const settings = new Schema(
  {
    _id: String,
    shopName: String,
    address: { type: String, default: '' },
    phone: { type: String, default: '' },
    affidavitTemplate: { type: String, default: DEFAULT_AFFIDAVIT },
    receiptSize: { type: String, default: 'a4' },
    scannerUrl: { type: String, default: '' },
    ratePaisa: { type: Number, default: 26000000 },
    rateUpdatedAt: Date,
    rateUpdatedBy: String,
    accessRevision: { type: Number, default: 0 },
  },
  opts,
);
export const Settings = mongoose.model('Settings', settings);
