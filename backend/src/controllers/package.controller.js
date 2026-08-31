import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { query } from '../config/db.js';
import { wrap } from '../utils/http.js';
import { badRequest, notFound } from '../utils/http.js';
import { reqMeta } from '../services/audit.js';
import * as pkgService from '../services/package.service.js';

function parseRecipients(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    } catch {}
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

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
  // E2E text drops supply ciphertext rather than plaintext secret_text.
  const isE2E = req.body.e2ee === 'true' || req.body.e2ee === true;
  if (type === 'text' && !isE2E && !req.body.secret_text?.trim()) throw badRequest('A secret message is required.');
  if (type === 'text' && isE2E && !req.body.enc_payload) throw badRequest('Encrypted payload is required for E2E content.');
  if (type === 'file' && !req.file) throw badRequest('A file upload is required.');

  const pkg = await pkgService.createPackage(
    {
      ...req.body,
      file: req.file || null,
      recipient_emails: parseRecipients(req.body.recipient_emails),
    },
    { creatorId, ip, userAgent }
  );
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
  const { password, recipientEmail } = req.body || {};
  const { ip, userAgent } = reqMeta(req);
  const result = await pkgService.openPackage(req.params.token, { password, ip, userAgent, recipientEmail });
  res.json(result);
});

export const mine = wrap(async (req, res) => {
  const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10) || 10, 1), 50);
  const data = await pkgService.listPackagesForCreator(req.auth.sub, { page, limit });
  res.json(data);
});

// owner's view of a single drop with its recipient read-status
export const mineDetail = wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT id, token, type, secret_text, e2ee, file_name, file_mime, file_size,
            expires_at, max_views, view_count, burn_after_reading,
            is_password_protected, status, revoked_at, created_at
     FROM packages WHERE token = $1 AND creator_id = $2`,
    [req.params.token, req.auth.sub]
  );
  if (!rows[0]) throw notFound('Package not found');
  const recipients = await pkgService.listRecipientsForPackage(rows[0].id);
  res.json({ pkg: rows[0], recipients });
});

export const download = wrap(async (req, res) => {
  const { ip, userAgent } = reqMeta(req);
  const { pkg, buffer, shouldBurnAfterDownload, mime, name } = await pkgService.getFileStream(
    req.query.token,
    { ip, userAgent }
  );

  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name || 'download')}`);
  res.setHeader('Content-Type', mime || 'application/octet-stream');
  res.setHeader('Content-Length', buffer.length);
  res.end(buffer);

  // after delivery, delete burn-after-reading files
  if (shouldBurnAfterDownload) {
    await pkgService.deleteStoredFile({ id: pkg.id, file_path: pkg.file_path });
  }
});

export const revoke = wrap(async (req, res) => {
  const { ip, userAgent } = reqMeta(req);
  const actorId = req.auth && req.auth.role === 'user' ? req.auth.sub : null;
  const isAdmin = req.auth && req.auth.role === 'admin';
  const pkg = await pkgService.revokePackage(req.params.token, { actorId, admin: !!isAdmin, ip, userAgent });
  res.json({ pkg: pkgServiceMeta(pkg) });
});
