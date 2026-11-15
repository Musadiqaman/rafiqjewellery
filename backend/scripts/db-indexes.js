import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectDatabase } from '../config/db.js';
await connectDatabase(env.MONGODB_URI);
for (const model of Object.values(mongoose.models)) {
  await model.createIndexes();
  console.log(`Indexes ready: ${model.modelName}`);
}
await mongoose.disconnect();
