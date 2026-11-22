import { Router } from 'express';
import multer from 'multer';
import { requireAuth, allow, rateLimit } from '../middlewares/security.js';
import {
  postMedia,
  getMediaId,
  getRecords,
  getRecordsExportCsv,
  getRecordsId,
  postRecords,
  postRecordsIdVoid,
  postRecordsIdDelete,
  getDashboard,
} from '../controllers/records.controller.js';
export const records = Router();
records.use(['/media', '/records', '/dashboard'], requireAuth);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1, fields: 2 },
});
records.post(
  '/media',
  allow('create'),
  rateLimit('upload', 100, 60000),
  upload.single('file'),
  postMedia,
);
records.get('/media/:id', allow('receipt'), getMediaId);
records.get('/records', allow('read'), getRecords);
records.get('/records/export.csv', allow('export'), getRecordsExportCsv);
records.get('/records/:id', allow('receipt'), getRecordsId);
records.post('/records', allow('create'), rateLimit('record-create', 60, 60000), postRecords);
records.post('/records/:id/void', allow('void'), postRecordsIdVoid);
records.post('/records/:id/delete', allow('delete'), postRecordsIdDelete);
records.get('/dashboard', allow('read'), getDashboard);
