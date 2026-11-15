import mongoose from 'mongoose';
import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Media, Purchase } from '../models/index.js';
import { env } from '../config/env.js';
import { HttpError } from '../middlewares/security.js';
let sharpPromise;
const loadSharp = () => {
  sharpPromise ||= import('sharp').then((module) => module.default);
  return sharpPromise;
};
const bucket = () =>
  new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'evidence' });
export async function saveMedia(bytes, userId, kind, source) {
  let info;
  try {
    const sharp = await loadSharp();
    info = await sharp(bytes, { limitInputPixels: 20000000 }).metadata();
    await sharp(bytes, { limitInputPixels: 20000000 }).stats();
  } catch {
    throw new HttpError(400, 'Choose a valid JPG, PNG or WebP image');
  }
  if (!info.format || !['jpeg', 'png', 'webp'].includes(info.format))
    throw new HttpError(400, 'Unsupported image format');
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', Buffer.from(env.ENCRYPTION_KEY, 'hex'), iv),
    encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const stream = bucket().openUploadStream(randomBytes(16).toString('hex'));
  await pipeline(Readable.from(encrypted), stream);
  try {
    return await Media.create({
      fileId: stream.id,
      createdBy: userId,
      mime: 'image/' + info.format,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      kind,
      source,
      expiresAt: new Date(Date.now() + 86400000),
    });
  } catch (e) {
    await bucket().delete(stream.id);
    throw e;
  }
}
export async function readMedia(m) {
  const chunks = [];
  for await (const c of bucket().openDownloadStream(m.fileId)) chunks.push(c);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(env.ENCRYPTION_KEY, 'hex'),
    Buffer.from(m.iv, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(m.tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.concat(chunks)), decipher.final()]);
}
export async function cleanUploads() {
  let count = 0;
  while (true) {
    const candidate = await Media.findOne({ expiresAt: { $lt: new Date() } });
    if (!candidate) break;
    if (candidate.recordId) {
      const owner = await Purchase.findById(candidate.recordId).select('state');
      if (owner && !['pending', 'failed'].includes(owner.state)) {
        await Media.updateOne(
          { _id: candidate._id, recordId: candidate.recordId },
          { $unset: { expiresAt: 1 } },
        );
        continue;
      }
      if (owner?.state === 'pending') {
        const cancelled = await Purchase.findOneAndUpdate(
          { _id: owner._id, state: 'pending' },
          {
            $set: {
              state: 'failed',
              cleanupPending: true,
              failure: 'The unfinished entry expired. Retry with fresh evidence.',
            },
          },
        );
        if (!cancelled) continue;
      }
      await Media.updateOne(
        { _id: candidate._id, recordId: candidate.recordId },
        { $unset: { recordId: 1 } },
      );
      continue;
    }
    const m = await Media.findOneAndDelete({
      _id: candidate._id,
      recordId: { $exists: false },
      expiresAt: { $lt: new Date() },
    });
    if (!m) continue;
    await bucket().delete(m.fileId);
    count++;
  }
  return count;
}
