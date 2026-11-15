import { Purchase } from '../models/index.js';
import { finishSetup, protectPrimaryAdmin } from './setup.js';
import { finishPurchase, releaseFailedAttachments } from './purchases.js';
import { syncPendingAudits } from './audit.js';

export async function recoverWrites() {
  await finishSetup();
  await protectPrimaryAdmin();
  const pending = await Purchase.find({ state: 'pending' })
    .select('_id')
    .sort({ createdAt: 1 })
    .limit(100)
    .lean();
  for (const row of pending) {
    try {
      await finishPurchase(row._id);
    } catch (error) {
      if (![400, 409].includes(error.status)) throw error;
    }
  }
  const failed = await Purchase.find({ state: 'failed', cleanupPending: true })
    .select('_id')
    .limit(100)
    .lean();
  for (const row of failed) await releaseFailedAttachments(row._id);
  await syncPendingAudits();
}
