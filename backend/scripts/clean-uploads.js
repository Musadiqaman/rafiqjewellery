import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectDatabase } from '../config/db.js';
import { cleanUploads } from '../services/media.js';
await connectDatabase(env.MONGODB_URI);
console.log(`Expired unattached uploads removed: ${await cleanUploads()}`);
await mongoose.disconnect();
