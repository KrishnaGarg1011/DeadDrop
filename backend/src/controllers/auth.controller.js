import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { unauthorized, conflict, badRequest } from '../utils/http.js';
import { wrap } from '../utils/http.js';
import { reqMeta } from '../services/audit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const signToken = (payload) => jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn });

async function logAuthAttempt(actorType, email, success, req) {
  const { ip, userAgent } = reqMeta(req);
  await query(
    `INSERT INTO auth_attempts (actor_type, email, success, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [actorType, email || null, success, ip, userAgent]
  );
}

export const register = wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const { ip, userAgent } = reqMeta(req);

  if (!email || !EMAIL_RE.test(email)) throw badRequest('A valid email is required.');
  if (!password || password.length < 6) throw badRequest('Password must be at least 6 characters.');

  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows[0]) throw conflict('An account with this email already exists.');

  const passwordHash = await bcrypt.hash(password, 11);
  const { rows } = await query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at`,
    [email, passwordHash]
  );
  const user = rows[0];

  await logAuthAttempt('user', email, true, req);
  const token = signToken({ sub: user.id, email: user.email, role: 'user' });

  res.status(201).json({ token, user: { id: user.id, email: user.email } });
});

export const login = wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw badRequest('Email and password are required.');

  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];

  const valid = user ? await bcrypt.compare(password, user.password_hash) : false;
  // uniform response so email enumeration is not trivially possible
  if (!user || !valid) {
    await logAuthAttempt('user', email, false, req);
    throw unauthorized('Invalid email or password.');
  }

  await logAuthAttempt('user', email, true, req);
  const token = signToken({ sub: user.id, email: user.email, role: 'user' });
  res.json({ token, user: { id: user.id, email: user.email } });
});

export const adminLogin = wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) throw badRequest('Username and password are required.');

  const { rows } = await query('SELECT * FROM admins WHERE username = $1', [username]);
  const admin = rows[0];

  const valid = admin ? await bcrypt.compare(password, admin.password_hash) : false;
  if (!admin || !valid) {
    await logAuthAttempt('admin', username, false, req);
    throw unauthorized('Invalid username or password.');
  }

  await logAuthAttempt('admin', username, true, req);
  const token = signToken({ sub: admin.id, username: admin.username, role: 'admin' });
  res.json({ token, admin: { id: admin.id, username: admin.username } });
});

// Light endpoint so the frontend can check "am I logged in as user or admin?"
export const me = wrap(async (req, res) => {
  if (req.auth && req.auth.role === 'admin') {
    return res.json({ role: 'admin', id: req.auth.sub, username: req.auth.username });
  }
  res.json({ role: 'user', id: req.auth.sub, email: req.auth.email });
});
