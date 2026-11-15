import { ENV_PATH, createEnvironmentFile, validateEnvironment } from '../config/environment.js';
const created = createEnvironmentFile();
console.log(
  created ? 'Created backend/.env with unique keys.' : 'Existing backend/.env kept unchanged.',
);
process.loadEnvFile(ENV_PATH);
try {
  validateEnvironment(process.env);
  console.log(
    'Configuration format is valid. Set MONGODB_URI if needed. Use SETUP_KEY from .env when creating the first administrator.',
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
