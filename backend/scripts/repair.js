import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectDatabase } from '../config/db.js';
import { recoverWrites } from '../services/recovery.js';
import { Purchase, User } from '../models/index.js';
try {
  await connectDatabase(env.MONGODB_URI);
  for (let pass = 0; pass < 100; pass++) {
    const pending = await Purchase.exists({
      $or: [{ state: 'pending' }, { cleanupPending: true }, { auditPending: true }],
    });
    if (!pending && !(await User.exists({ auditPending: true }))) break;
    await recoverWrites();
  }
  console.log('Interrupted saves and pending audit events checked.');
} finally {
  await mongoose.disconnect();
}
