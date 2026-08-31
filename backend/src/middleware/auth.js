import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthorized, forbidden } from '../utils/http.js';

// Verify a bearer token and assert its role.
function requireRole(role) {
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next(unauthorized('Missing access token'));

    try {
      const payload = jwt.verify(token, env.jwtSecret);
      if (payload.role !== role) return next(forbidden('Insufficient role'));
      req.auth = payload;
      next();
    } catch {
      next(unauthorized('Invalid or expired token'));
    }
  };
}

export const requireUser = requireRole('user');
export const requireAdmin = requireRole('admin');

// Attach the authenticated identity only if a valid token is present
// (used so anonymous package creation can optionally be attributed).
export function optionalAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, env.jwtSecret);
      if (payload.role === 'user') req.auth = payload;
    } catch {
      /* ignore invalid token on optional auth */
    }
  }
  next();
}
