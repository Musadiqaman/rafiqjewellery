import { createEnvironmentFile } from './config/environment.js';
let stage = 'configuration';
try {
  if (!['production', 'test'].includes(process.env.NODE_ENV) && createEnvironmentFile())
    console.log('Created backend/.env with unique keys and the local MongoDB URI.');
  const { env } = await import('./config/env.js');
  try {
    await import('sharp');
  } catch {
    throw Error(
      'Sharp could not load. Run npm install --include=optional sharp@0.35.5 in backend, then npm run doctor.',
    );
  }
  const { app } = await import('./app.js');
  const { connectDatabase } = await import('./config/db.js');
  const { default: mongoose } = await import('mongoose');
  stage = 'database';
  await connectDatabase(env.MONGODB_URI, { ensureIndexes: true, recover: true });
  console.log(
    `MongoDB connected: ${mongoose.connection.name}. Records: purchases; encrypted images: evidence.files / evidence.chunks.`,
  );
  const server = app.listen(env.PORT, '0.0.0.0', () =>
    console.log(`API ready on port ${env.PORT}`),
  );
  server.on('error', async (error) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? `Port ${env.PORT} is already in use. Stop the other backend process.`
        : 'Unable to start the API listener.',
    );
    await mongoose.disconnect();
    process.exitCode = 1;
  });
  function stop() {
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  }
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} catch (error) {
  const detail = `${error.name}, code ${error.code ?? 'unavailable'}${error.codeName ? `, ${error.codeName}` : ''}`;
  if (stage === 'database' && error.startupStage === 'indexes')
    console.error(
      `MongoDB index setup failed for model ${error.startupModel} (${detail}). Check that model's index definitions.`,
    );
  else if (stage === 'database' && error.startupStage === 'recovery')
    console.error(
      `MongoDB write recovery failed (${detail}). Check database access and retry startup.`,
    );
  else if (stage === 'database')
    console.error(
      `Database connection failed (${detail}). Check that MongoDB is running and MONGODB_URI in backend/.env is correct. Standalone MongoDB is supported; no replica setup is required.`,
    );
  else console.error(error.message);
  process.exitCode = 1;
}
