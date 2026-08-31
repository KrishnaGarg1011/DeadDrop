# DeadDrop Frontend — Vue 3 + Vite

The client for the DeadDrop secure file-exchange platform.

## Stack
- **Vue 3** (Composition API)
- **Vite** build tool
- **Vue Router** (hash-free history) + **Pinia** (state)

## Run

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # production build to dist/
```

The Vite dev server proxies `/api` → `http://127.0.0.1:5000` (see `vite.config.js`),
so the SPA talks to the Express backend using relative URLs with no CORS issues.

## Views

| Route | Purpose |
|-------|---------|
| `/` | **Sender** — create a text or file drop, set expiry (view/time/none), password, burn-after-reading, failed-attempt lock; then get a shareable link |
| `/v/:token` | **Recipient** — opens the unique link; shows password gate, reveals the secret message, or streams the file; renders clear error screens for expired / burned / locked / exhausted / revoked |
| `/login` | User **and admin** login (toggle) |
| `/register` | Sender account creation |
| `/admin` | **Admin dashboard** — Overview stats, Packages (search/filter/paginate/revoke), Users, Failed Attempts, Audit Log |

## Structure
```
src/
  main.js          entry
  App.vue          shell + top nav
  router/index.js  routes + admin guard
  stores/auth.js   Pinia auth (user/admin tokens)
  api/client.js    fetch wrapper (JWT header, error normalization)
  styles/base.css  design tokens
  components/      Pagination.vue
  views/           HomeView, RecipientView, LoginView, RegisterView
  views/admin/     AdminLayout, Overview, Packages, Users, FailedAttempts, AuditLog
```
