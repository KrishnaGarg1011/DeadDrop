import { HttpError } from '../utils/http.js';
import { isProd } from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Endpoint not found' });
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  // Multer upload errors (e.g. file too large)
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File is too large for an upload.' });
  }

  const status = err instanceof HttpError ? err.statusCode : 500;
  const message = err instanceof HttpError ? err.message : 'Internal server error';

  if (status >= 500) console.error('[error]', err);

  res.status(status).json({
    error: message,
    ...(isProd ? {} : { stack: err.stack }),
  });
}
