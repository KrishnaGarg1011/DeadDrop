import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import { query, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { notFound, forbidden, conflict, tooMany } from '../utils/http.js';
import { audit } from './audit.js';
import { newFileKey, encryptBuffer, decryptBuffer } from './crypto.service.js';
import { notifyPackageEvent } from './realtime.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    e2ee: !!pkg.e2ee,
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
    // feature set
    e2ee,
    enc_payload,
    enc_iv,
    enc_salt,
    file_crypto,
    recipient_emails,
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
  const e2eeEnabled = toBool(e2ee);
  const fileCryptoEnabled = toBool(file_crypto);

  let passwordHash = null;
  if (isProtected && !e2eeEnabled) {
    if (!password) throw conflict('password is required when password protection is enabled');
    if (password.length < 4) throw conflict('password must be at least 4 characters');
    passwordHash = await bcrypt.hash(password, 11);
  }

  // E2E text: content is encrypted client-side; the server stores only ciphertext.
  if (type === 'text' && e2eeEnabled) {
    if (!enc_payload || !enc_iv || !enc_salt) {
      throw conflict('enc_payload, enc_iv and enc_salt are required for E2E encryption');
    }
  }

  let attemptsLimit = env.maxFailedAttempts;
  if (max_failed_attempts != null && max_failed_attempts !== '') {
    attemptsLimit = Number(max_failed_attempts);
    if (!Number.isInteger(attemptsLimit) || attemptsLimit < 1) throw conflict('max_failed_attempts must be a positive integer');
  }

  // Encrypt the file at rest (AES-256-GCM) so the disk never holds plaintext.
  let fileKeyB64 = null;
  let fileIvB64 = null;
  let fileTagB64 = null;
  let cryptoFlag = false;
  if (type === 'file' && file && fileCryptoEnabled) {
    const absPath = path.resolve(env.uploadsDir, file.filename);
    if (fs.existsSync(absPath)) {
      const buf = fs.readFileSync(absPath);
      const key = newFileKey();
      const { enc, iv, tag } = encryptBuffer(buf, key);
      fs.writeFileSync(absPath, enc);
      fileKeyB64 = key.toString('base64');
      fileIvB64 = iv.toString('base64');
      fileTagB64 = tag.toString('base64');
      cryptoFlag = true;
    }
  }

  const { rows } = await query(
    `INSERT INTO packages (
        creator_id, type, secret_text, file_name, file_path, file_mime, file_size,
        expires_at, max_views, burn_after_reading,
        is_password_protected, password_hash, max_failed_attempts,
        e2ee, enc_payload, enc_iv, enc_salt, file_crypto, file_key, file_iv, file_tag
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     RETURNING *`,
    [
      creatorId,
      type,
      type === 'text' ? (e2eeEnabled ? null : secret_text) : null,
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
      e2eeEnabled,
      type === 'text' && e2eeEnabled ? enc_payload : null,
      type === 'text' && e2eeEnabled ? enc_iv : null,
      type === 'text' && e2eeEnabled ? enc_salt : null,
      cryptoFlag,
      fileKeyB64,
      fileIvB64,
      fileTagB64,
    ]
  );

  const pkg = rows[0];

  // Shared / team drop: register invited recipients.
  const recipients = Array.isArray(recipient_emails) ? recipient_emails : [];
  if (recipients.length) {
    for (const email of recipients) {
      if (EMAIL_RE.test(email)) {
        await query(
          `INSERT INTO package_recipients (package_id, recipient_email) VALUES ($1, $2)`,
          [pkg.id, email]
        );
      }
    }
  }

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
      e2ee: e2eeEnabled,
      fileCrypto: cryptoFlag,
      recipients: recipients.length,
      expiresAt: pkg.expires_at,
      maxViews: pkg.max_views,
    },
    ip,
    userAgent,
  });

  return pkg;
}

// ---------------------------------------------------------------------------
// "Your drops" for a logged-in sender
// ---------------------------------------------------------------------------
export async function listPackagesForCreator(creatorId, { page, limit }) {
  const offset = (page - 1) * limit;
  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total FROM packages WHERE creator_id = $1`,
    [creatorId]
  );
  const { rows } = await query(
    `SELECT id, token, type, file_name, file_size, expires_at, max_views, view_count,
            burn_after_reading, is_password_protected, e2ee, status, revoked_at, created_at
     FROM packages WHERE creator_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [creatorId, limit, offset]
  );
  return { list: rows, total: countRows[0].total, page, limit };
}

export async function listRecipientsForPackage(packageId) {
  const { rows } = await query(
    `SELECT id, recipient_email, opened_at, acknowledged_at, created_at
     FROM package_recipients WHERE package_id = $1 ORDER BY created_at ASC`,
    [packageId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Per-drop lifecycle / delivery log (senders see WHEN, WHO, and WHAT, but never
// the secret message content). Combines audit + access logs.
// ---------------------------------------------------------------------------
export async function getPackageEventLog(packageId) {
  const { rows: auditRows } = await query(
    `SELECT 'state' AS kind, action, details, ip_address, user_agent, created_at
       FROM audit_logs
      WHERE entity_type = 'package' AND entity_id = $1`,
    [packageId]
  );
  const { rows: accessRows } = await query(
    `SELECT 'access' AS kind, success, reason, ip_address, user_agent, created_at
       FROM access_logs WHERE package_id = $1`,
    [packageId]
  );
  const events = [...auditRows, ...accessRows]
    .map((e) => ({ ...e, created_at: new Date(e.created_at) }))
    .sort((a, b) => b.created_at - a.created_at);
  return events;
}

// ---------------------------------------------------------------------------
// Recipient "acknowledge" — a manual "I've seen it" tap. Records read time and
// notifies the sender in real time. Visible without exposing content.
// ---------------------------------------------------------------------------
export async function acknowledgePackage(token, { recipientEmail, ip, userAgent }) {
  const { rows } = await query(`SELECT id, token, creator_id, type, status FROM packages WHERE token = $1`, [token]);
  if (!rows[0]) throw notFound('Package not found');
  const pkg = rows[0];

  // If a recipient email is supplied, mark that recipient as read/acknowledged.
  let affected = 0;
  if (recipientEmail && EMAIL_RE.test(recipientEmail)) {
    const up = await query(
      `UPDATE package_recipients
          SET opened_at = coalesce(opened_at, now()), acknowledged_at = now()
        WHERE package_id = $1 AND recipient_email = $2`,
      [pkg.id, recipientEmail]
    );
    affected = up.rowCount;
  }

  // Always log the acknowledge event even without a named recipient.
  await audit({
    actorType: pkg.creator_id ? 'sender' : 'anonymous',
    action: 'package.acknowledged',
    entityType: 'package',
    entityId: pkg.id,
    details: { recipient: recipientEmail || null, status: pkg.status },
    ip,
    userAgent,
  });

  if (pkg.creator_id != null) {
    await notifyPackageEvent({
      packageId: String(pkg.id),
      creatorId: String(pkg.creator_id),
      token: pkg.token,
      action: 'acknowledged',
      recipient: recipientEmail || null,
      at: new Date().toISOString(),
    });
  }

  return { acknowledged: true, affected };
}

// ---------------------------------------------------------------------------
// Metadata for the recipient view (no content revealed yet)
// ---------------------------------------------------------------------------
export async function getMetadata(token) {
  const { rows } = await query(`SELECT ${publicPackageColumns} FROM packages WHERE token = $1`, [token]);
  if (!rows[0]) throw notFound('Package not found');
  let pkg = await ensureNotExpired(rows[0]);
  const meta = toPublicMeta(pkg);
  // expose whether this is a shared/team drop (senders set recipients)
  const { rows: rc } = await query(
    `SELECT count(*)::int AS n FROM package_recipients WHERE package_id = $1`,
    [pkg.id]
  );
  meta.shared = (rc[0]?.n || 0) > 0;
  return meta;
}

// ---------------------------------------------------------------------------
// Open (unlock) — the single entry point that validates all access rules.
// ---------------------------------------------------------------------------
export async function openPackage(token, { password, ip, userAgent, recipientEmail }) {
  void recipientEmail;
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

  // ---- password check (server-side verifies only non-E2E packages) ----
  if (pkg.is_password_protected && !pkg.e2ee) {
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
        // wipe plaintext AND any E2E ciphertext so nothing lingers
        secretsToNull = `, secret_text = NULL, enc_payload = NULL, enc_iv = NULL, enc_salt = NULL`;
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

  const action = result.updated.burn_after_reading
    ? 'package.burned'
    : result.updated.status === 'expired'
      ? 'package.exhausted'
      : 'package.opened';
  await audit({ action, entityType: 'package', entityId: pkg.id, details: { views: result.updated.view_count }, ip, userAgent });

  // Mark a shared-drop recipient as read.
  if (recipientEmail) {
    await query(
      `UPDATE package_recipients SET opened_at = now()
       WHERE package_id = $1 AND recipient_email = $2 AND opened_at IS NULL`,
      [pkg.id, recipientEmail]
    );
  }

  // Notify the sender in real time (only if the sender has an account).
  if (pkg.creator_id != null) {
    await notifyPackageEvent({
      packageId: String(pkg.id),
      creatorId: String(pkg.creator_id),
      token: pkg.token,
      action: result.updated.burn_after_reading ? 'burned'
        : result.updated.status === 'expired' ? 'exhausted' : 'opened',
      views: result.updated.view_count,
      at: new Date().toISOString(),
    });
  }

  if (pkg.type === 'text') {
    if (pkg.e2ee) {
      // Client decrypts locally; server held only the ciphertext.
      return {
        type: 'text',
        encrypted: true,
        payload: pkg.enc_payload,
        iv: pkg.enc_iv,
        salt: pkg.enc_salt,
        burnAfterReading: pkg.burn_after_reading,
        viewCount: result.updated.view_count,
      };
    }
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

  // Read the file; decrypt at-rest ciphertext into a plaintext buffer for download.
  let buffer = fs.readFileSync(absPath);
  if (pkg.file_crypto && pkg.file_key && pkg.file_iv && pkg.file_tag) {
    try {
      buffer = decryptBuffer(
        buffer,
        Buffer.from(pkg.file_key, 'base64'),
        Buffer.from(pkg.file_iv, 'base64'),
        Buffer.from(pkg.file_tag, 'base64')
      );
    } catch (err) {
      throw forbidden('File could not be decrypted.');
    }
  }

  // After a burn-after-reading file has been downloaded, permanently delete it.
  const shouldBurnAfterDownload = pkg.burn_after_reading;
  await logAccess({ packageId: pkg.id, token: pkg.token, success: true, reason: 'file_downloaded', ip, userAgent });
  if (shouldBurnAfterDownload) {
    await audit({ action: 'package.burned', entityType: 'package', entityId: pkg.id, details: { reason: 'file_downloaded' }, ip, userAgent });
  }

  return { pkg, buffer, shouldBurnAfterDownload, mime: pkg.file_mime, name: pkg.file_name, size: buffer.length };
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
