import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { wrap } from '../utils/http.js';
import { badRequest } from '../utils/http.js';
import { reqMeta } from '../services/audit.js';
import * as pkgService from '../services/package.service.js';

// ---------------------------------------------------------------------------
// File upload handling (stored on local disk under UPLOADS_DIR)
// ---------------------------------------------------------------------------
fs.mkdirSync(env.uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, env.uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 12);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: env.maxFileSize },
  fileFilter: (req, file, cb) => cb(null, true),
});

// ---------------------------------------------------------------------------
export const create = wrap(async (req, res) => {
  const { type } = req.body || {};
  const { ip, userAgent } = reqMeta(req);
  const creatorId = req.auth && req.auth.role === 'user' ? req.auth.sub : null;

  if (type !== 'text' && type !== 'file') throw badRequest("'type' must be 'text' or 'file'.");
  if (type === 'text' && !req.body.secret_text?.trim()) throw badRequest('A secret message is required.');
  if (type === 'file' && !req.file) throw badRequest('A file upload is required.');

  const pkg = await pkgService.createPackage({ ...req.body, file: req.file || null }, { creatorId, ip, userAgent });
  res.status(201).json({ pkg: pkgServiceMeta(pkg) });
});

function pkgServiceMeta(pkg) {
  return {
    token: pkg.token,
    type: pkg.type,
    fileName: pkg.file_name,
    fileSize: pkg.file_size,
    expiresAt: pkg.expires_at,
    maxViews: pkg.max_views,
    viewCount: pkg.view_count,
    burnAfterReading: pkg.burn_after_reading,
    isPasswordProtected: pkg.is_password_protected,
    status: pkg.status,
    createdAt: pkg.created_at,
  };
}

export const metadata = wrap(async (req, res) => {
  const meta = await pkgService.getMetadata(req.params.token);
  res.json({ pkg: meta });
});

export const open = wrap(async (req, res) => {
  const { password } = req.body || {};
  const { ip, userAgent } = reqMeta(req);
  const result = await pkgService.openPackage(req.params.token, { password, ip, userAgent });
  res.json(result);
});

export const download = wrap(async (req, res) => {
  const { ip, userAgent } = reqMeta(req);
  const { pkg, absPath, shouldBurnAfterDownload } = await pkgService.getFileStream(
    req.query.token,
    { ip, userAgent }
  );

  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(pkg.file_name || 'download')}`);
  res.setHeader('Content-Type', pkg.file_mime || 'application/octet-stream');
  res.setHeader('Content-Length', pkg.file_size);

  const stream = fs.createReadStream(absPath);
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).end();
  });
  stream.on('close', async () => {
    // once the client has fully received the bytes, delete burn-after-reading files
    if (shouldBurnAfterDownload) {
      await pkgService.deleteStoredFile({ id: pkg.id, file_path: pkg.file_path });
    }
  });
  stream.pipe(res);
});

export const revoke = wrap(async (req, res) => {
  const { ip, userAgent } = reqMeta(req);
  const actorId = req.auth && req.auth.role === 'user' ? req.auth.sub : null;
  const isAdmin = req.auth && req.auth.role === 'admin';
  const pkg = await pkgService.revokePackage(req.params.token, { actorId, admin: !!isAdmin, ip, userAgent });
  res.json({ pkg: pkgServiceMeta(pkg) });
});
