# DeadDrop — Ephemeral Secure File Exchange Platform

A production-ready full-stack app for exchanging temporary packages (a secret text
message or an uploaded file) that self-destruct on view, expiry, or lockout.

**Tech stack (as assigned):** Vue 3 + Vite · Express.js · PostgreSQL (raw `pg`, no ORM).

## Architecture

```
deaddrop/
  schema.sql                 PostgreSQL migration (schema + function + seed)
  backend/                   Express API
    src/
      config/                env + pg pool
      middleware/            JWT auth, rate limiting, error handling
      routes/                auth, package, admin
      controllers/           request handling + validation
      services/              package state machine, audit logging
      utils/, server.js, app.js
    uploads/                 local file storage (path tracked in DB)
  frontend/                  Vue 3 + Vite SPA
    src/
      router/, stores/, api/, views/, views/admin/, components/
```

## Features
- **Create** a text or file package with:
  - expiry by **time** (hours/days) or **view limit** (or none)
  - optional **password**, **burn-after-reading**, **failed-attempt lockout**
- **Recipient** opens a unique `/v/:token` link → password gate → reveals message /
  streams file → clear error screens for expired/burned/locked/exhausted/revoked
- **Access control** — every attempt logged (success/fail, reason, IP, user-agent);
  automatic state transitions (active → expired / burned / locked); creator/admin
  can revoke
- **Admin dashboard** — stats, packages (search/filter/paginate/revoke), users,
  failed attempts, and a comprehensive audit log

## Quick start (local)

```bash
# 1. Database — or just use the auto-migrate step below (no psql needed)
createdb deaddrop
psql deaddrop < schema.sql          # creates tables + seed admin

# 2. Backend — schema is auto-applied on start via `npm run db:migrate`
cd backend
cp .env.example .env                # set DATABASE_URL + secrets
npm install && npm run dev          # http://localhost:5000

# 3. Frontend
cd frontend
npm install && npm run dev          # http://localhost:5173
```
> The backend runs `node scripts/migrate.js` (idempotent) before starting, so
> the database schema is created automatically from `schema.sql` — nobody needs
> `psql` or to type a password.

Default admin: **admin / admin123**.

## Deploying

See **[DEPLOY.md](DEPLOY.md)** for a step-by-step Railway (backend + Postgres +
persistent disk) and optional Vercel (frontend) walkthrough. Everything is
env-var driven; no secrets are committed.

## Demo flow
1. Open `/` → create a locked, burn-after-reading drop → copy the link.
2. Open the link in a private window → enter the password → message reveals
   (and is then destroyed). Re-opens show the "unavailable" screen.
3. Log in as admin (`/login` → Admin tab) → see the package, its status, failed
   attempts, and every audit entry.
