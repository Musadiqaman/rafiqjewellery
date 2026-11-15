import { app } from '../app.js';
import { env } from '../config/env.js';
import { connectDatabase } from '../config/db.js';
export default async function handler(req, res) {
  try {
    await connectDatabase(env.MONGODB_URI);
  } catch {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'Database unavailable. Check the server configuration.' }));
    return;
  }
  return app(req, res);
}
