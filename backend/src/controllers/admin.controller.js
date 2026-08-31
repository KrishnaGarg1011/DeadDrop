import { query } from '../config/db.js';
import { wrap } from '../utils/http.js';
import { badRequest, notFound } from '../utils/http.js';
import { reqMeta } from '../services/audit.js';
import { revokePackage } from '../services/package.service.js';

// ---------------------------------------------------------------------------
// Pagination + filtering helpers (shared across dashboard views)
// ---------------------------------------------------------------------------
function pagination(req) {
  const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10) || 10, 1), 100);
  return { page, limit, offset: (page - 1) * limit };
}

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// Never return password hashes or filesystem paths to the API client.
function sanitizePackage(pkg) {
  if (!pkg) return pkg;
  const { password_hash, file_path, ...safe } = pkg;
  return safe;
}

// ---------------------------------------------------------------------------
export const stats = wrap(async (req, res) => {
  const { rows } = await query(`
    SELECT
      (SELECT count(*)::int FROM packages)                          AS total_packages,
      (SELECT count(*)::int FROM packages WHERE status = 'active')  AS active_packages,
      (SELECT count(*)::int FROM packages WHERE status = 'expired') AS expired_packages,
      (SELECT count(*)::int FROM packages WHERE status = 'locked')  AS locked_packages,
      (SELECT count(*)::int FROM packages WHERE status = 'burned')  AS burned_packages,
      (SELECT count(*)::int FROM packages WHERE status = 'revoked') AS revoked_packages,
      (SELECT count(*)::int FROM users)                             AS total_users,
      (SELECT count(*)::int FROM access_logs)                       AS total_views,
      (SELECT count(*)::int FROM access_logs WHERE success = false) AS failed_accesses,
      (SELECT count(*)::int FROM auth_attempts WHERE success = false) AS failed_logins,
      (SELECT coalesce(sum(file_size), 0)::bigint FROM packages WHERE file_size IS NOT NULL) AS stored_bytes
  `);
  res.json({ stats: rows[0] });
});

export const packages = wrap(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const { status, type, q } = req.query;

  const where = [];
  const params = [];
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (type) {
    params.push(type);
    where.push(`type = $${params.length}`);
  }
  if (q) {
    params.push(`%${esc(q)}%`);
    where.push(`(token ILIKE $${params.length} OR file_name ILIKE $${params.length} OR id::text = $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const whereParams = params;

  const countParams = [...whereParams];
  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total FROM packages ${whereSql}`,
    countParams
  );
  const total = countRows[0].total;

  const listParams = [...whereParams, limit, offset];
  const { rows } = await query(
    `SELECT id, token, creator_id, type, file_name, file_mime, file_size,
            expires_at, max_views, view_count, burn_after_reading,
            is_password_protected, failed_attempts, max_failed_attempts,
            status, revoked_at, created_at
     FROM packages ${whereSql}
     ORDER BY created_at DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  res.json({ list: rows, total, page, limit });
});

export const packageDetail = wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await query('SELECT * FROM packages WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Package not found');
  const pkg = rows[0];

  const logs = await query(
    `SELECT success, reason, ip_address, user_agent, created_at
     FROM access_logs WHERE package_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [id]
  );
  res.json({ pkg: sanitizePackage(pkg), accessLogs: logs.rows });
});

export const users = wrap(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const { q } = req.query;
  const params = [];
  let where = '';
  if (q) {
    params.push(`%${esc(q)}%`);
    where = `WHERE email ILIKE $1`;
  }
  const countParams = [...params];
  const { rows: countRows } = await query(`SELECT count(*)::int AS total FROM users ${where}`, countParams);
  const total = countRows[0].total;

  const listParams = [...params, limit, offset];
  const { rows } = await query(
    `SELECT u.id, u.email, u.created_at,
            (SELECT count(*)::int FROM packages p WHERE p.creator_id = u.id) AS package_count
     FROM users u ${where}
     ORDER BY u.created_at DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );
  res.json({ list: rows, total, page, limit });
});

export const failedAttempts = wrap(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const { kind } = req.query; // 'access' | 'login' | undefined (both)

  const accessWhere = [];
  const loginWhere = [];
  const params = [];
  let sql;

  if (kind === 'login') {
    const { rows: countRows } = await query(
      `SELECT count(*)::int AS total FROM auth_attempts WHERE success = false`
    );
    const { rows } = await query(
      `SELECT id, actor_type AS type, email, ip_address, user_agent, created_at
       FROM auth_attempts WHERE success = false
       ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return res.json({ list: rows, total: countRows[0].total, page, limit });
  }

  if (kind === 'access') {
    const { rows: countRows } = await query(
      `SELECT count(*)::int AS total FROM access_logs WHERE success = false`
    );
    const { rows } = await query(
      `SELECT id, 'access' AS type, token, reason, ip_address, user_agent, created_at
       FROM access_logs WHERE success = false
       ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return res.json({ list: rows, total: countRows[0].total, page, limit });
  }

  // combined view
  const { rows: countRows } = await query(`
    SELECT (
      (SELECT count(*) FROM access_logs WHERE success = false) +
      (SELECT count(*) FROM auth_attempts WHERE success = false)
    )::int AS total
  `);
  const { rows } = await query(`
    SELECT id, 'access' AS type, token AS subject, reason AS detail, ip_address, user_agent, created_at
      FROM access_logs WHERE success = false
    UNION ALL
    SELECT id, 'login'  AS type, email AS subject, 'failed_login' AS detail, ip_address, user_agent, created_at
      FROM auth_attempts WHERE success = false
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);

  res.json({ list: rows, total: countRows[0].total, page, limit });
});

export const auditLogs = wrap(async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const { action, actorType, entityType, q } = req.query;

  const where = [];
  const params = [];
  if (action) {
    params.push(action);
    where.push(`action = $${params.length}`);
  }
  if (actorType) {
    params.push(actorType);
    where.push(`actor_type = $${params.length}`);
  }
  if (entityType) {
    params.push(entityType);
    where.push(`entity_type = $${params.length}`);
  }
  if (q) {
    params.push(`%${esc(q)}%`);
    where.push(`(action ILIKE $${params.length} OR details::text ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows: countRows } = await query(`SELECT count(*)::int AS total FROM audit_logs ${whereSql}`, params);
  const total = countRows[0].total;

  const listParams = [...params, limit, offset];
  const { rows } = await query(
    `SELECT id, actor_type, actor_id, action, entity_type, entity_id, details, ip_address, user_agent, created_at
     FROM audit_logs ${whereSql}
     ORDER BY created_at DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );
  res.json({ list: rows, total, page, limit });
});

// admin-only revoke
export const revoke = wrap(async (req, res) => {
  const { ip, userAgent } = reqMeta(req);
  const pkg = await revokePackage(req.params.token, { admin: true, ip, userAgent });
  res.json({ pkg: sanitizePackage(pkg) });
});
