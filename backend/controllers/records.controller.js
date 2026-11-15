import {
  savePurchase,
  voidPurchase,
  deletePurchase,
  publicPurchase,
  visiblePurchase,
} from '../services/purchases.js';
import { Types } from 'mongoose';
import { z } from 'zod';
import { Purchase, Media } from '../models/index.js';
import { csvCell } from '../validators/domain.js';
import { HttpError, audit } from '../middlewares/security.js';
import { buildQuery } from '../services/query.js';
import { saveMedia, readMedia } from '../services/media.js';

export const postMedia = async (req, res) => {
  const d = z
    .object({
      kind: z.enum(['photo', 'signature', 'thumb']),
      source: z.enum(['upload', 'signature', 'scanner', 'camera', 'ink']),
    })
    .strict()
    .parse(req.body);
  if (!req.file) throw new HttpError(400, 'Select an image');
  const m = await saveMedia(req.file.buffer, req.user._id, d.kind, d.source);
  res.status(201).json({ id: String(m._id), sha256: m.sha256 });
};

export const getMediaId = async (req, res) => {
  if (!Types.ObjectId.isValid(String(req.params.id))) throw new HttpError(404, 'Image not found');
  const m = await Media.findById(req.params.id);
  if (!m) throw new HttpError(404, 'Image not found');
  if (
    String(m.createdBy) !== String(req.user._id) &&
    !(m.recordId && (await Purchase.exists({ _id: m.recordId, ...visiblePurchase })))
  )
    throw new HttpError(404, 'Image not found');
  res
    .type(m.mime)
    .set('Cache-Control', 'no-store')
    .set('Content-Disposition', 'inline')
    .send(await readMedia(m));
};

export const getRecords = async (req, res) => {
  const q = buildQuery(req.query),
    rows = await Purchase.find(q.filter)
      .select(
        'reference purchasedAt customer.name customer.cnic items grams tola totalPaisa evidenceStatus voided createdByName',
      )
      .sort({ purchasedAt: -1, _id: -1 })
      .limit(q.input.limit + 1)
      .lean()
      .maxTimeMS(5000);
  const more = rows.length > q.input.limit;
  if (more) rows.pop();
  res.json({ items: rows, nextCursor: more ? q.cursor(rows.at(-1)) : null });
};

export const getRecordsExportCsv = async (req, res) => {
  const q = buildQuery(req.query);
  if ((await Purchase.countDocuments(q.base).maxTimeMS(5000)) > 10000)
    throw new HttpError(400, 'Narrow the date range to 10,000 records or fewer');
  await audit(req, 'records.export', 'CSV requested');
  res.type('text/csv').set('Content-Disposition', 'attachment; filename="gold-purchases.csv"');
  res.write(
    '\uFEFF' +
      ['Reference', 'Date', 'Customer', 'CNIC', 'Phone', 'Items', 'Grams', 'Amount PKR', 'Status']
        .map(csvCell)
        .join(',') +
      '\r\n',
  );
  const cursor = Purchase.find(q.base)
    .sort({ purchasedAt: -1, _id: -1 })
    .lean()
    .cursor({ batchSize: 100 });
  try {
    for await (const r of cursor) {
      if (res.destroyed) break;
      const line =
        [
          r.reference,
          r.purchasedAt?.toISOString(),
          r.customer?.name,
          r.customer?.cnic,
          r.customer?.phone,
          r.items.join(', '),
          r.grams,
          (r.totalPaisa || 0) / 100,
          r.voided ? 'void' : r.evidenceStatus,
        ]
          .map(csvCell)
          .join(',') + '\r\n';
      if (!res.write(line))
        await new Promise((resolve) => {
          const done = () => {
            res.off('drain', done);
            res.off('close', done);
            resolve();
          };
          res.once('drain', done);
          res.once('close', done);
        });
    }
  } finally {
    await cursor.close();
  }
  res.end();
};

export const getRecordsId = async (req, res) => {
  if (!Types.ObjectId.isValid(String(req.params.id))) throw new HttpError(404, 'Record not found');
  const r = await Purchase.findOne({ _id: req.params.id, ...visiblePurchase }).lean();
  if (!r) throw new HttpError(404, 'Record not found');
  await audit(req, 'record.view', r.reference, r._id);
  res.json({
    ...publicPurchase(r),
    media: await Media.find({ recordId: r._id }).select('_id sha256 kind source mime size').lean(),
  });
};

export const postRecords = async (req, res) => {
  const result = await savePurchase(req.body, req);
  res.status(result.created ? 201 : 200).json(result.record);
};

export const postRecordsIdVoid = async (req, res) => {
  const { reason } = z
    .object({ reason: z.string().trim().min(10).max(500) })
    .strict()
    .parse(req.body);
  if (!Types.ObjectId.isValid(String(req.params.id))) throw new HttpError(404, 'Record not found');
  res.json(await voidPurchase(req.params.id, reason, req));
};

export const postRecordsIdDelete = async (req, res) => {
  const { reason } = z
    .object({ reason: z.string().trim().min(10).max(500) })
    .strict()
    .parse(req.body);
  if (!Types.ObjectId.isValid(String(req.params.id))) throw new HttpError(404, 'Record not found');
  res.json(await deletePurchase(req.params.id, reason, req));
};

export const getDashboard = async (req, res) => {
  const q = buildQuery(req.query);
  const [summary, rows] = await Promise.all([
    Purchase.aggregate([
      { $match: { $and: [q.base, { voided: false }] } },
      {
        $group: {
          _id: null,
          amount: { $sum: '$totalPaisa' },
          grams: { $sum: '$grams' },
          tola: { $sum: '$tola' },
          count: { $sum: 1 },
        },
      },
    ]).option({ maxTimeMS: 5000 }),
    Purchase.find(q.filter)
      .select(
        'reference purchasedAt customer.name customer.cnic items grams tola totalPaisa evidenceStatus voided createdByName',
      )
      .sort({ purchasedAt: -1, _id: -1 })
      .limit(q.input.limit + 1)
      .lean()
      .maxTimeMS(5000),
  ]);
  const more = rows.length > q.input.limit;
  if (more) rows.pop();
  res.json({
    stats: summary[0] || { amount: 0, grams: 0, tola: 0, count: 0 },
    items: rows,
    nextCursor: more ? q.cursor(rows.at(-1)) : null,
  });
};
