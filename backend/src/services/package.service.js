import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import { query, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { notFound, forbidden, conflict, tooMany } from '../utils/http.js';
import { audit } from './audit.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Mark any time-expired 'active' packages as 'expired' via the SQL helper.
export async function expirePackages() {
  await query('SELECT fn_expire_packages()');
}

// Inline expiry check for a single package read outside the interval job.
async function ensureNotExpired(pkg) {
  if (pkg.status === 'active' && pkg.expires_at && new Date(pkg.expires_at) <= new Date()) {
    const { rows } = await query(
      `UPDATE packages SET status = 'expired' WHERE id = $1 RETURNING *`,
      [pkg.id]
    );
    if (rows[0]) pkg = rows[0];
    await audit({ action: 'package.expired', entityType: 'package', entityId: pkg.id, details: { reason: 'time_limit_reached' } });
  }
  return pkg;
}

function signFileToken(packageId) {
  return jwt.sign({ pid: String(packageId), purpose: 'file' }, env.fileTokenSecret, {
    expiresIn: `${Math.floor(env.fileTokenTtlMs / 1000)}s`,
  });
}

export function verifyFileToken(token) {
  try {
    const payload = jwt.verify(token, env.fileTokenSecret);
    if (payload.purpose !== 'file') return null;
    return payload;
  } catch {
    return null;
  }
}

// Records an access attempt (success or failure) in the audit of the package.
async function logAccess({ packageId, token, success, reason, ip, userAgent }) {
  await query(
    `INSERT INTO access_logs (package_id, token, success, reason, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [packageId, token, success, reason, ip || null, userAgent || null]
  );
}

const publicPackageColumns = `
  id, token, creator_id, type, file_name, file_mime, file_size,
  expires_at, max_views, view_count, burn_after_reading,
  is_password_protected, failed_attempts, max_failed_attempts,
  status, revoked_at, created_at
`;

// Strip nothing sensitive except the content itself — metadata is public so the
// recipient view can render the "this link is dead" screen appropriately.
function toPublicMeta(pkg) {
  return {
    token: pkg.token,
    type: pkg.type,
    fileName: pkg.file_name,
    fileMime: pkg.file_mime,
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

// Multipart/form-data sends all fields as strings; coerce to native types.
function toBool(v) {
  if (v === true || v === 'true' || v === '1' || v === 1) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export async function createPackage(input, { creatorId, ip, userAgent }) {
  const {
    type,
    secret_text,
    file, // multer file object
    expires_in_hours,
    expires_at,
    max_views,
    burn_after_reading,
    is_password_protected,
    password,
    max_failed_attempts,
  } = input;

  // lifecycle: at least one of time-based expiry or a view limit may be set
  let expiresAt = null;
  if (expires_at) {
    expiresAt = new Date(expires_at);
    if (Number.isNaN(expiresAt.getTime())) throw conflict('Invalid expires_at value');
    if (expiresAt.getTime() <= Date.now()) throw conflict('expires_at must be in the future');
  } else if (expires_in_hours != null && expires_in_hours !== '') {
    const hours = Number(expires_in_hours);
    if (!Number.isFinite(hours) || hours <= 0) throw conflict('expires_in_hours must be a positive number');
    expiresAt = new Date(Date.now() + hours * 3600 * 1000);
  }

  let maxViews = null;
  if (max_views != null && max_views !== '') {
    maxViews = Number(max_views);
    if (!Number.isInteger(maxViews) || maxViews < 1) throw conflict('max_views must be a positive integer');
  }

  const burn = toBool(burn_after_reading);
  const isProtected = toBool(is_password_protected);
  let passwordHash = null;
  if (isProtected) {
    if (!password) throw conflict('password is required when password protection is enabled');
    if (password.length < 4) throw conflict('password must be at least 4 characters');
    passwordHash = await bcrypt.hash(password, 11);
  }

  let attemptsLimit = env.maxFailedAttempts;
  if (max_failed_attempts != null && max_failed_attempts !== '') {
    attemptsLimit = Number(max_failed_attempts);
    if (!Number.isInteger(attemptsLimit) || attemptsLimit < 1) throw conflict('max_failed_attempts must be a positive integer');
  }

  const { rows } = await query(
    `INSERT INTO packages (
        creator_id, type, secret_text, file_name, file_path, file_mime, file_size,
        expires_at, max_views, burn_after_reading,
        is_password_protected, password_hash, max_failed_attempts
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      creatorId,
      type,
      type === 'text' ? secret_text : null,
      file ? file.originalname : null,
      file ? `uploads/${file.filename}` : null,
      file ? file.mimetype : null,
      file ? file.size : null,
      expiresAt,
      maxViews,
      burn,
      isProtected,
      passwordHash,
      attemptsLimit,
    ]
  );

  const pkg = rows[0];

  await audit({
    actorType: creatorId ? 'user' : 'anonymous',
    actorId: creatorId,
    action: 'package.created',
    entityType: 'package',
    entityId: pkg.id,
    details: {
      type,
      burn,
      isProtected,
      expiresAt: pkg.expires_at,
      maxViews: pkg.max_views,
    },
    ip,
    userAgent,
  });

  return pkg;
}

// ---------------------------------------------------------------------------
// Metadata for the recipient view (no content revealed yet)
// ---------------------------------------------------------------------------
export async function getMetadata(token) {
  const { rows } = await query(`SELECT ${publicPackageColumns} FROM packages WHERE token = $1`, [token]);
  if (!rows[0]) throw notFound('Package not found');
  let pkg = await ensureNotExpired(rows[0]);
  return toPublicMeta(pkg);
}

// ---------------------------------------------------------------------------
// Open (unlock) — the single entry point that validates all access rules.
// ---------------------------------------------------------------------------
export async function openPackage(token, { password, ip, userAgent }) {
  const { rows } = await query(`SELECT * FROM packages WHERE token = $1`, [token]);
  if (!rows[0]) throw notFound('Package not found');

  let pkg = await ensureNotExpired(rows[0]);

  // ---- return early errors based on current status ----
  if (pkg.status === 'revoked') {
    await logAccess({ packageId: pkg.id, token, success: false, reason: 'revoked', ip, userAgent });
    throw forbidden('This package has been revoked.');
  }
  if (pkg.status === 'burned') {
    await logAccess({ packageId: pkg.id, token, success: false, reason: 'burned', ip, userAgent });
    throw forbidden('This package was already viewed and burned.');
  }
  if (pkg.status === 'locked') {
    await logAccess({ packageId: pkg.id, token, success: false, reason: 'locked', ip, userAgent });
    throw tooMany('This package is locked due to too many failed attempts.');
  }
  if (pkg.status === 'expired') {
    const exhausted = pkg.max_views != null && pkg.view_count >= pkg.max_views;
    await logAccess({ packageId: pkg.id, token, success: false, reason: exhausted ? 'exhausted' : 'expired', ip, userAgent });
    throw conflict(exhausted ? 'This package has reached its view limit.' : 'This package has expired.');
  }
  if (pkg.max_views != null && pkg.view_count >= pkg.max_views) {
    await logAccess({ packageId: pkg.id, token, success: false, reason: 'exhausted', ip, userAgent });
    throw conflict('This package has reached its view limit.');
  }

  // ---- password check ----
  if (pkg.is_password_protected) {
    const ok = password ? await bcrypt.compare(password, pkg.password_hash) : false;
    if (!ok) {
      const newCount = pkg.failed_attempts + 1;
      const willLock = newCount >= pkg.max_failed_attempts;
      const { rows: u } = await query(
        `UPDATE packages SET failed_attempts = $2,
           status = CASE WHEN $3 THEN 'locked'::package_status ELSE status END
         WHERE id = $1 RETURNING *`,
        [pkg.id, newCount, willLock]
      );
      pkg = u[0];
      await logAccess({
        packageId: pkg.id, token, success: false,
        reason: willLock ? 'locked' : 'wrong_password', ip, userAgent,
      });
      await audit({
        action: willLock ? 'package.locked' : 'package.access_failed',
        entityType: 'package', entityId: pkg.id,
        details: { reason: 'wrong_password', failedAttempts: newCount },
        ip, userAgent,
      });
      if (willLock) {
        throw tooMany('This package is now locked due to too many failed attempts.');
      }
      throw forbidden('Incorrect password.');
    }
  }

  // ---- success path (transacted so counting + burn are atomic) ----
  const result = await withTransaction(async (client) => {
    const nextViews = pkg.view_count + 1;
    const isLastView = pkg.max_views != null && nextViews >= pkg.max_views;

    let secretText = pkg.secret_text;
    if (pkg.type === 'text') {
      secretText = pkg.secret_text;
    }

    let newStatus = 'active';
    let secretsToNull = '';
    if (pkg.burn_after_reading) {
      newStatus = 'burned';
      if (pkg.type === 'text') {
        secretsToNull = `, secret_text = NULL`;
      }
    } else if (isLastView) {
      // reach max, mark as expired (view-limit exhausted)
      newStatus = 'expired';
    }

    const { rows: up } = await client.query(
      `UPDATE packages
         SET view_count = $2,
             status = $3::package_status
             ${secretsToNull}
       WHERE id = $1
       RETURNING *`,
      [pkg.id, nextViews, newStatus]
    );
    const updated = up[0];

    return { updated, secretText };
  });

  await logAccess({ packageId: pkg.id, token, success: true, reason: 'ok', ip, userAgent });

  await audit({
    action: result.updated.burn_after_reading
      ? 'package.burned'
      : result.updated.status === 'expired'
        ? 'package.exhausted'
        : 'package.opened',
    entityType: 'package', entityId: pkg.id,
    details: { views: result.updated.view_count },
    ip, userAgent,
  });

  if (pkg.type === 'text') {
    return {
      type: 'text',
      secretText: result.secretText,
      burnAfterReading: pkg.burn_after_reading,
      viewCount: result.updated.view_count,
    };
  }

  // file: issue a short-lived token so the client can perform one download
  return {
    type: 'file',
    file: { name: pkg.file_name, mime: pkg.file_mime, size: pkg.file_size },
    burnAfterReading: pkg.burn_after_reading,
    viewCount: result.updated.view_count,
    downloadToken: signFileToken(pkg.id),
  };
}

// ---------------------------------------------------------------------------
// Stream a file for a verified download token.
// ---------------------------------------------------------------------------
export async function getFileStream(downloadToken, { ip, userAgent }) {
  const payload = verifyFileToken(downloadToken);
  if (!payload) throw forbidden('Invalid or expired download link.');

  const { rows } = await query(`SELECT * FROM packages WHERE id = $1`, [payload.pid]);
  const pkg = rows[0];
  if (!pkg || pkg.type !== 'file' || !pkg.file_path) {
    throw notFound('File is no longer available.');
  }

  const absPath = path.resolve(env.uploadsDir, path.basename(pkg.file_path));
  if (!fs.existsSync(absPath)) {
    throw notFound('File is no longer available.');
  }

  // After a burn-after-reading file has been downloaded, permanently delete it.
  const shouldBurnAfterDownload = pkg.burn_after_reading;
  await logAccess({ packageId: pkg.id, token: pkg.token, success: true, reason: 'file_downloaded', ip, userAgent });
  if (shouldBurnAfterDownload) {
    await audit({ action: 'package.burned', entityType: 'package', entityId: pkg.id, details: { reason: 'file_downloaded' }, ip, userAgent });
  }

  return { pkg, absPath, shouldBurnAfterDownload };
}

export async function deleteStoredFile(pkg) {
  try {
    if (pkg.file_path) {
      const absPath = path.resolve(env.uploadsDir, path.basename(pkg.file_path));
      if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
    }
    await query(`UPDATE packages SET file_path = NULL WHERE id = $1`, [pkg.id]);
  } catch (err) {
    console.error('[file] failed to delete stored file', err.message);
  }
}

// ---------------------------------------------------------------------------
// Revoke (owner or admin)
// ---------------------------------------------------------------------------
export async function revokePackage(token, { actorId, admin = false, ip, userAgent }) {
  const { rows } = await query(`SELECT * FROM packages WHERE token = $1`, [token]);
  if (!rows[0]) throw notFound('Package not found');
  const pkg = rows[0];

  if (!admin && pkg.status !== 'active') {
    throw conflict('Only active packages can be revoked.');
  }
  if (!admin && pkg.status === 'active' && pkg.creator_id && pkg.creator_id !== actorId) {
    throw forbidden('You can only revoke your own packages.');
  }

  const { rows: up } = await query(
    `UPDATE packages SET status = 'revoked', revoked_at = now(), revoked_by = $2
     WHERE id = $1 RETURNING *`,
    [pkg.id, admin ? 'admin' : 'user']
  );

  await audit({
    actorType: admin ? 'admin' : pkg.creator_id ? 'user' : 'anonymous',
    actorId: admin ? null : actorId,
    action: 'package.revoked',
    entityType: 'package',
    entityId: pkg.id,
    details: { by: admin ? 'admin' : 'creator' },
    ip, userAgent,
  });

  return up[0];
}
