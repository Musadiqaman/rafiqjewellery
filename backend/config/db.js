import mongoose from 'mongoose';
import '../models/index.js';
import { recoverWrites } from '../services/recovery.js';

export function localCompatibleUri(uri, mode = process.env.NODE_ENV) {
  // Compatibility with the original generated development .env. Remote replica
  // set choices and production configuration are never changed.
  if (mode === 'production') return uri;
  try {
    const u = new URL(uri);
    if (
      u.protocol === 'mongodb:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) &&
      u.pathname === '/rafiq_ledger' &&
      u.searchParams.get('replicaSet') === 'rs0'
    ) {
      u.searchParams.delete('replicaSet');
      return u.toString();
    }
  } catch {}
  return uri;
}

let connectionPromise;
let indexesPromise;
let recoveryPromise;
mongoose.connection.on('disconnected', () => {
  connectionPromise = undefined;
  indexesPromise = undefined;
  recoveryPromise = undefined;
});

async function ensureModelIndexes() {
  for (const model of Object.values(mongoose.models)) {
    try {
      await model.createIndexes();
    } catch (error) {
      error.startupStage = 'indexes';
      error.startupModel = model.modelName;
      throw error;
    }
  }
}

async function recoverPendingWrites() {
  try {
    await recoverWrites();
  } catch (error) {
    error.startupStage = 'recovery';
    throw error;
  }
}

export async function connectDatabase(uri, options = {}) {
  if (!connectionPromise) {
    mongoose.set('strictQuery', true);
    mongoose.set('bufferCommands', false);
    connectionPromise = mongoose
      .connect(localCompatibleUri(uri), {
        maxPoolSize: 15,
        minPoolSize: 0,
        serverSelectionTimeoutMS: 8000,
        autoIndex: false,
      })
      .then(() => mongoose.connection)
      .catch(async (error) => {
        connectionPromise = undefined;
        await mongoose.disconnect();
        throw error;
      });
  }

  const connection = await connectionPromise;

  // Vercel calls this without options so cold starts only establish/reuse the
  // connection. Index provisioning and write recovery remain explicit tasks.
  if (options.ensureIndexes) {
    indexesPromise ||= ensureModelIndexes().catch((error) => {
      indexesPromise = undefined;
      throw error;
    });
    await indexesPromise;
  }

  if (options.recover) {
    recoveryPromise ||= recoverPendingWrites().catch((error) => {
      recoveryPromise = undefined;
      throw error;
    });
    await recoveryPromise;
  }

  return connection;
}
