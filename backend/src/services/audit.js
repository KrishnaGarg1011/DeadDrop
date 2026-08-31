import { query } from '../config/db.js';

// Append-only audit trail helper. Never throws on a failed write; audit
// failures should not fail the primary request, but we log them.
export async function audit({ actorType = 'system', actorId = null, action, entityType = null, entityId = null, details = {}, ip = null, userAgent = null }) {
  try {
    await query(
      `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [actorType, actorId, action, entityType, entityId, JSON.stringify(details), ip, userAgent]
    );
  } catch (err) {
    console.error('[audit] failed to write audit entry', err.message);
  }
}

export const reqMeta = (req) => ({
  ip: req.ip || (req.headers['x-forwarded-for'] || '').split(',')[0] || null,
  userAgent: req.get('user-agent') || null,
});
