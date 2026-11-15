import { Types } from 'mongoose';
import { Purchase, Settings, Media, Counter } from '../models/index.js';
import {
  entrySchema,
  calculate,
  normalizeName,
  namePrefixes,
  renderAffidavit,
  DEFAULT_AFFIDAVIT,
  can,
} from '../validators/domain.js';
import { HttpError, hash } from '../middlewares/security.js';
import { auditEvent, tryFlushAudit } from './audit.js';

export const visiblePurchase = { state: { $nin: ['pending', 'failed'] }, deleted: { $ne: true } };
export function publicPurchase(doc) {
  const value = doc?.toObject ? doc.toObject() : { ...doc };
  for (const key of [
    'state',
    'failure',
    'cleanupPending',
    'evidenceIds',
    'auditEvents',
    'auditPending',
    'requestHash',
  ])
    delete value[key];
  return value;
}
function assertSameRequest(doc, userId, requestHash) {
  if (String(doc.createdBy) !== String(userId) || doc.requestHash !== requestHash)
    throw new HttpError(409, 'Submission key was already used with different details');
}
async function nextReference(date) {
  const day = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }).replaceAll('-', '');
  let seq;
  try {
    seq = await Counter.findOneAndUpdate(
      { _id: day },
      { $inc: { value: 1 } },
      { upsert: true, new: true },
    );
  } catch (e) {
    if (e.code !== 11000) throw e;
    seq = await Counter.findOneAndUpdate({ _id: day }, { $inc: { value: 1 } }, { new: true });
  }
  return `RJ-${day}-${String(seq.value).padStart(4, '0')}`;
}

export async function releaseFailedAttachments(id) {
  if (!(await Purchase.exists({ _id: id, state: 'failed' }))) return;
  await Media.updateMany(
    { recordId: id },
    {
      $unset: { recordId: 1 },
      $set: { expiresAt: new Date(Date.now() + 86400000) },
    },
  );
  await Purchase.updateOne({ _id: id, state: 'failed' }, { $set: { cleanupPending: false } });
}

export async function finishPurchase(id) {
  let draft = await Purchase.findById(id);
  if (!draft) throw new HttpError(404, 'Record not found');
  if (draft.state === 'failed') {
    await releaseFailedAttachments(id);
    const error = new HttpError(
      400,
      draft.failure || 'This save failed. Retry to upload the evidence again.',
    );
    error.resetSubmission = true;
    throw error;
  }
  if (draft.state !== 'pending') {
    await tryFlushAudit(Purchase, id);
    return draft;
  }
  try {
    // Each claim is atomic. Expiry cleanup only deletes unclaimed uploads.
    // Claims belong to a durable draft, so interrupted saves can resume.
    for (const mediaId of [...draft.evidenceIds].sort((a, b) =>
      String(a).localeCompare(String(b)),
    )) {
      const kind =
        String(mediaId) === String(draft.signatureId)
          ? 'signature'
          : String(mediaId) === String(draft.thumbId)
            ? 'thumb'
            : 'photo';
      const file = await Media.findOneAndUpdate(
        {
          _id: mediaId,
          createdBy: draft.createdBy,
          kind,
          ...(kind === 'thumb' ? { source: draft.thumbSource } : {}),
          $or: [{ recordId: id }, { recordId: { $exists: false }, expiresAt: { $gt: new Date() } }],
        },
        { $set: { recordId: id, expiresAt: new Date(Date.now() + 86400000) } },
        { new: true },
      );
      if (!file)
        throw new HttpError(
          400,
          'An attachment is unavailable, expired or already used. Start a new entry and upload it again.',
        );
    }
    // Only this single atomic document update makes the bill visible.
    const committed = await Purchase.findOneAndUpdate(
      { _id: id, state: 'pending' },
      {
        $set: { state: 'committed', auditPending: true },
      },
      { new: true },
    );
    draft = committed || (await Purchase.findById(id));
    if (draft.state !== 'committed')
      throw new HttpError(409, 'This save could not be completed. Start a new entry.');
    try {
      await Media.updateMany({ recordId: id }, { $unset: { expiresAt: 1 } });
    } catch {
      console.error(
        'Evidence retention metadata pending; committed purchase remains authoritative.',
      );
    }
    await tryFlushAudit(Purchase, id);
    return draft;
  } catch (error) {
    // Network failures leave the draft recoverable; they never release evidence
    // that may already belong to a committed purchase.
    if (error instanceof HttpError || error.code === 11000) {
      const failed = await Purchase.findOneAndUpdate(
        { _id: id, state: 'pending' },
        {
          $set: {
            state: 'failed',
            failure:
              'An attachment could not be reserved. Start a new entry and upload the evidence again.',
            cleanupPending: true,
          },
        },
        { new: true },
      );
      if (failed) {
        await releaseFailedAttachments(id);
        error.resetSubmission = true;
      } else {
        const saved = await Purchase.findById(id);
        if (saved?.state === 'committed') return saved;
        if (saved?.state === 'failed') {
          await releaseFailedAttachments(id);
          error.resetSubmission = true;
        }
      }
      if (error.code === 11000) {
        const conflict = new HttpError(
          409,
          'An attachment is already used. Retry to upload it again.',
        );
        conflict.resetSubmission = error.resetSubmission;
        throw conflict;
      }
    }
    throw error;
  }
}

export async function savePurchase(input, req) {
  const d = entrySchema.parse(input),
    requestHash = hash(JSON.stringify(d));
  let draft = await Purchase.findOne({ idempotencyKey: d.idempotencyKey });
  if (draft) {
    assertSameRequest(draft, req.user._id, requestHash);
    return { record: publicPurchase(await finishPurchase(draft._id)), created: false };
  }
  const settings = await Settings.findById('shop').lean();
  if (!settings) throw new HttpError(503, 'Finish shop setup');
  if (!can(req.user.role, 'rate') && d.ratePaisa !== settings.ratePaisa)
    throw new HttpError(409, 'The shop rate changed. Refresh the rate before saving.');
  const ids = [
    ...d.photoIds,
    ...(d.signatureId ? [d.signatureId] : []),
    ...(d.thumbId ? [d.thumbId] : []),
  ];
  if (new Set(ids).size !== ids.length)
    throw new HttpError(400, 'Evidence attachments must be unique');
  const sums = calculate(d.weight, d.ratePaisa),
    purchasedAt = new Date(),
    id = new Types.ObjectId();
  const reference = await nextReference(purchasedAt);
  const document = {
    ...d,
    ...sums,
    _id: id,
    state: 'pending',
    evidenceIds: ids,
    purchasedAt,
    reference,
    requestHash,
    customer: {
      ...d.customer,
      nameNormalized: normalizeName(d.customer.name),
      namePrefixes: namePrefixes(d.customer.name),
    },
    evidenceStatus: d.signatureId || d.thumbId ? 'complete' : 'incomplete',
    declarationText: renderAffidavit(settings.affidavitTemplate || DEFAULT_AFFIDAVIT, {
      name: d.customer.name || 'the seller',
      cnic: d.customer.cnic ? d.customer.cnic.replace(/^(\d{5})(\d{7})(\d)$/, '$1-$2-$3') : 'not provided',
      phone: d.customer.phone,
      weight: `${sums.grams.toFixed(3)} g`,
      tola: sums.tola.toFixed(4),
      date: purchasedAt.toLocaleString('en-GB', { timeZone: 'Asia/Karachi' }),
      shop: settings.shopName,
      rate: `Rs ${(d.ratePaisa / 100).toLocaleString('en-PK')}`,
      amount: `Rs ${(sums.totalPaisa / 100).toLocaleString('en-PK')}`,
    }),
    shopSnapshot: { name: settings.shopName, address: settings.address, phone: settings.phone },
    createdBy: req.user._id,
    createdByName: req.user.name,
    auditEvents: [auditEvent(req, 'record.created', reference, id, `purchase:${id}:created`)],
  };
  let created = true;
  try {
    draft = await Purchase.create(document);
  } catch (error) {
    if (error.code !== 11000) throw error;
    draft = await Purchase.findOne({ idempotencyKey: d.idempotencyKey });
    if (!draft) throw error;
    assertSameRequest(draft, req.user._id, requestHash);
    created = false;
  }
  return { record: publicPurchase(await finishPurchase(draft._id)), created };
}

export async function voidPurchase(id, reason, req) {
  const event = auditEvent(req, 'record.voided', reason, id, `purchase:${id}:voided`);
  const record = await Purchase.findOneAndUpdate(
    { _id: id, ...visiblePurchase, voided: false },
    {
      $set: {
        voided: true,
        voidReason: reason,
        voidedAt: new Date(),
        voidedBy: req.user._id,
        auditPending: true,
      },
      $push: { auditEvents: event },
    },
    { new: true },
  );
  if (!record) throw new HttpError(409, 'Record is missing or already voided');
  await tryFlushAudit(Purchase, id);
  return publicPurchase(record);
}

export async function deletePurchase(id, reason, req) {
  const event = auditEvent(req, 'record.deleted', reason, id, `purchase:${id}:deleted`);
  const record = await Purchase.findOneAndUpdate(
    { _id: id, ...visiblePurchase, deleted: { $ne: true } },
    {
      $set: {
        deleted: true,
        deleteReason: reason,
        deletedAt: new Date(),
        deletedBy: req.user._id,
        auditPending: true,
      },
      $push: { auditEvents: event },
    },
    { new: true },
  );
  if (!record) throw new HttpError(409, 'Purchase is missing or has already been deleted');
  await tryFlushAudit(Purchase, id);
  return publicPurchase(record);
}
