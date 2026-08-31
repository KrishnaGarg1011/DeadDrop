# Deploying DeadDrop (Railway)

This guide shows how to put the whole stack online with **no manual file editing
and no `psql` password typing**. Everything is driven by environment variables
set once in the Railway dashboard, and the database schema is created
automatically on first boot.

## Two things to know up front

1. **No secrets live in the repo.** `.gitignore` excludes `.env` and `uploads/`.
   Reviewers clone the repo, add their own env vars, and it runs.
2. **The stack needs a long-running server + local disk** for file uploads and
   the background expiry job. That's why we use **Railway** (a real Node host
   with a persistent volume) rather than Vercel serverless functions.

---

## 1. Push the project to GitHub

The repo root must contain `schema.sql`, `backend/`, `frontend/`, and the root
`Dockerfile`. (A root `Dockerfile` exists so `schema.sql` is in the build
context.)

```bash
git init
git add .
git commit -m "DeadDrop: ephemeral secure file exchange"
git branch -M main
git remote add origin https://github.com/<you>/deaddrop.git
git push -u origin main
```

---

## 2. Create the PostgreSQL database (Railway)

1. Go to [railway.app](https://railway.app) → **New Project** → **Provision PostgreSQL**.
2. Wait for it to provision. Open the Postgres service → **Variables** → copy the
   `DATABASE_URL` value.
   - It will look like `postgresql://...`. **Keep the scheme as `postgresql://`**
     (the app normalizes it), or change it to `postgres://`.
3. Note the host/port. Railway Postgres uses a **private networking URL**; for
   the backend that's fine, but if you ever connect from outside Railway use
   the public URL.

---

## 3. Create the backend service (Docker)

1. In your project, **New Service** → **Dockerfile** → point at the repo.
2. **Settings → Deploy** → set **Build context** to the repo root (the `Dockerfile`
   at the root references `schema.sql`).
3. **Variables** — add:
   | Variable | Value |
   |----------|-------|
   | `DATABASE_URL` | the `postgresql://...` string from step 2 |
   | `JWT_SECRET` | a long random string |
   | `FILE_TOKEN_SECRET` | another long random string |
   | `UPLOADS_DIR` | `/app/uploads` |
   | `PORT` | `5000` |
   | `MAX_FAILED_ATTEMPTS` | `5` |
   | `MAX_FILE_SIZE` | `10485760` |
   | `EXPIRE_INTERVAL_MS` | `60000` |
4. **Volumes** — add a volume mounted at **`/app/uploads`** so uploaded files
   persist across restarts. This is essential for file drops.
5. **Settings → Networking** — generate a public domain. The app listens on
   `0.0.0.0:5000` (set `PORT=5000`), so expose port **5000**.

### Why these are safe defaults
- `JWT_SECRET` / `FILE_TOKEN_SECRET` sign your tokens. Set them in the dashboard
  once — never hardcode them in code. Everyone who deploys picks their own.
- The **migration runs automatically**: the container's start command runs
  `node scripts/migrate.js` (idempotent — creates the 6 tables the first time,
  skips if present) then starts the server. **No `psql` needed by anyone.**
- A default admin **`admin` / `admin123`** is seeded. Change its password after
  first login by updating `password_hash` in the `admins` table.

---

## 4. (Optional) Host the frontend on Vercel

1. Import the repo in [vercel.com](https://vercel.com) → root dir = `frontend`.
2. Framework preset: **Vite**. Build: `npm run build`, output `dist`.
3. **Environment variables** → set:
   | Variable | Value |
   |----------|-------|
   | `VITE_API_BASE` | `https://<your-backend-domain.up.railway.app>` |

   Note: set it with **no trailing slash**. The app proxies `/api` in dev; in
   production it calls `VITE_API_BASE` directly (CORS is already enabled on the
   backend).
4. Deploy. Your frontend now calls the hosted backend.

> If you'd rather not split across two platforms, you can also serve the built
> `dist/` from the backend (Railway) and skip Vercel entirely.

---

## 5. Verify it's live

- `https://<your-backend-domain>/api/health` → `{"ok":true,...}`
- Open the frontend URL → compose a drop → the generated link opens correctly.
- Log in as admin (username `admin`, password `admin123`) → admin dashboard
  shows live stats.

---

## Local development (unchanged)
```bash
createdb deaddrop
cd backend && npm install && cp .env.example .env && npm run dev   # :5000
cd frontend && npm install && npm run dev                          # :5173
```
The frontend's dev server proxies `/api` → `http://127.0.0.1:5000`, so no CORS
config is needed locally.

---

## Common troubleshooting
- **"failed to start" / DB connection error** → `DATABASE_URL` is wrong, or the
  Postgres service isn't running. Re-copy the connection string.
- **File uploads vanish on restart** → the volume isn't mounted at `/app/uploads`.
- **Frontend can't reach the API in production** → `VITE_API_BASE` is unset/empty,
  or missing the scheme/domain.
- **`postgresql://` vs `postgres://`** → the app handles both if you keep the
  `DATABASE_URL` exactly as Railway provides it; the migrate script and pool both
  accept it.
