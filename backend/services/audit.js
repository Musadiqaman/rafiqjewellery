import { Audit, Purchase, User } from '../models/index.js';

export function auditEvent(req, action, detail = '', recordId, eventKey = req.requestId) {
  return {
    eventKey,
    actorId: req.user?._id,
    actorName: req.user?.name,
    action,
    detail,
    recordId,
    requestId: req.requestId,
    createdAt: new Date(),
  };
}

// Events are committed with their authoritative document. This collection is a
// searchable projection; a crash or temporary failure can replay it safely.
export async function flushAudit(model, id) {
  const doc = await model.findById(id).select('auditEvents auditPending').lean();
  if (!doc?.auditPending) return;
  const events = doc.auditEvents || [];
  for (const event of events) {
    try {
      await Audit.updateOne(
        { eventKey: event.eventKey },
        { $setOnInsert: event },
        { upsert: true },
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }
  await model.updateOne(
    { _id: id, auditEvents: { $size: events.length } },
    { $set: { auditPending: false } },
  );
}

export async function tryFlushAudit(model, id) {
  try {
    await flushAudit(model, id);
  } catch {
    console.error('Audit projection pending; the durable event will be retried.');
  }
}

export async function syncPendingAudits() {
  for (const model of [Purchase, User]) {
    const rows = await model.find({ auditPending: true }).select('_id').limit(100).lean();
    for (const row of rows) await flushAudit(model, row._id);
  }
}

export const audit = (req, action, detail = '', recordId) =>
  Audit.create({
    actorId: req.user?._id,
    actorName: req.user?.name,
    action,
    detail,
    recordId,
    requestId: req.requestId,
  });
