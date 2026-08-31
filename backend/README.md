# DeadDrop API — Express.js Backend

REST API for the DeadDrop ephemeral secure file-exchange platform.

## Stack
- **Node.js** + **Express.js**
- **PostgreSQL** (via `pg` / node-postgres, no ORM)
- Auth via **JWT**, passwords hashed with **bcrypt**
- Files stored on local disk (`uploads/`), paths tracked in Postgres

## Setup

```bash
# 1. Create the database and load the schema (Postgres must be running)
createdb deaddrop
psql deaddrop < ../schema.sql        # or run schema.sql against your DB

# 2. Configure environment
cp .env.example .env                 # then edit DATABASE_URL, secrets, etc.

# 3. Install & run
npm install
npm run dev                          # or: npm start
```

The server listens on `http://localhost:5000` (configurable via `PORT`).

> The seed admin account is **admin / admin123**. Regenerate the bcrypt hash for
> production and update `admins` accordingly.

## Config (`src/config/env.js` from `.env`)

| Var | Default | Notes |
|-----|---------|-------|
| `DATABASE_URL` | `postgres://.../deaddrop` | PG connection string |
| `JWT_SECRET` | dev value | signing secret for access tokens |
| `JWT_EXPIRES_IN` | `7d` | access token lifetime |
| `FILE_TOKEN_SECRET` | dev value | short-lived file download tokens |
| `FILE_TOKEN_TTL_MS` | `300000` | 5 min download token TTL |
| `MAX_FAILED_ATTEMPTS` | `5` | default lockout threshold |
| `MAX_FILE_SIZE` | `10485760` | 10 MB upload cap |
| `UPLOADS_DIR` | `uploads` | local file storage |
| `EXPIRE_INTERVAL_MS` | `60000` | how often time-expired packages are marked |

## Endpoints

### Auth
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/auth/register` | — | create sender account (email + password) |
| POST | `/api/auth/login` | — | user login |
| POST | `/api/auth/admin/login` | — | admin login |
| GET  | `/api/auth/me` | optional | role/identity of the token |

### Packages (public — the token *is* the credential)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/packages` | optional | multi-part create (`type=text` or `type=file`) |
| GET  | `/api/packages/:token/metadata` | — | non-sensitive metadata for the recipient view |
| POST | `/api/packages/:token/open` | — | unlock (`{password?}`); enforces expiry/views/burn/lock |
| GET  | `/api/packages/:token/download?token=` | — | download a file (short-lived token from `/open`) |
| POST | `/api/packages/:token/revoke` | optional | creator revoke |

### Admin (`requireAdmin` — admin JWT required)
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/admin/stats` | platform totals |
| GET | `/api/admin/packages?status=&type=&q=&page=&limit=` | filter/search/paginate |
| GET | `/api/admin/packages/:id` | detail + recent access logs |
| POST | `/api/admin/packages/:token/revoke` | admin revoke |
| GET | `/api/admin/users?q=&page=&limit=` | users + package counts |
| GET | `/api/admin/failed-attempts?kind=access|login` | failed attempts |
| GET | `/api/admin/audit-logs?action=&actorType=&entityType=&q=&page=&limit=` | audit trail |

## Package lifecycle states
`active → expired` (time limit) · `active → burned` (burn-after-reading) ·
`active → locked` (failed attempts) · `active → revoked` (creator/admin)

Every create/open/download/revoke/state-change writes an **audit_log** entry,
and every open attempt (success or fail) writes an **access_log** row with
reason, IP, and user-agent.
