import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { spawn } from 'node:child_process';
const db = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger' } });
try {
  const child = spawn(process.execPath, ['--test', 'tests/integration.test.js'], {
    stdio: 'inherit',
    env: { ...process.env, MONGODB_URI_TEST: db.getUri() },
  });
  await new Promise((resolve) =>
    child.on('exit', (code) => {
      process.exitCode = code;
      resolve();
    }),
  );
} finally {
  await db.stop();
}
