# Production Go-Live Checklist

Pre-launch review of the `admin-events-zones` branch. Fundamentals are solid
(bcrypt hashing, JWT auth, rate-limited register/login, input validation, `.env`
gitignored, atomic double-claim fix). Status below; deployment steps live in
`server/DEPLOY.md`.

## 🔴 Blockers

- [x] **DEV_MODE fails closed in production.** `index.js` now refuses to boot under
  `NODE_ENV=production` unless `DEV_MODE=false` is set explicitly. Still verify
  after deploy via `/api/health` → `devMode:false`.

- [x] **Boot-time secret checks.** Production boot asserts `JWT_SECRET` exists and
  isn't a known placeholder, `ADMIN_SECRET` isn't a placeholder/short, and
  `CLIENT_ORIGIN` is set. Generate real values: `openssl rand -base64 32`.
  - [ ] *At deploy time*: actually generate and set the secrets on the droplet.

## 🟠 High

- [x] **Admin routes hardened.** CORS locked to `CLIENT_ORIGIN` (Express + Socket.io),
  admin router rate-limited (60/min in prod), secret compared with
  `crypto.timingSafeEqual`.

- [x] **Rate limiter proxy-safe.** Keys off `req.ip` (respects Express
  `trust proxy`, set via `TRUST_PROXY=1` behind nginx) instead of spoofable
  `x-forwarded-for`. Still per-process in-memory — fine for a single instance;
  revisit before scaling out.

## 🟡 Polish

- [x] **Tick/bot log spam gated behind `DEV_MODE`.** Errors still log; boot and
  season/bot-creation lines kept.

- [x] **`helmet` added** for standard security headers.

- [ ] **Schema relies on migrations.** `world_events`, `seasons`, `country_crowns`,
  etc. exist only via `runMigrations()`, not `schema.sql`. Self-heals on boot —
  documented in `server/DEPLOY.md` (boot once, watch for `[db] Migrations complete`).
  Consolidating into `schema.sql` is a nice-to-have, not a launch blocker.

## 🚀 Deploy (see `server/DEPLOY.md`)

- [ ] Droplet: postgres, systemd unit, nginx + certbot TLS
- [ ] Client production build (`VITE_API_URL`/`VITE_SOCKET_URL` → prod domain)
- [ ] Run the go-live verification checklist in DEPLOY.md
- [ ] Daily `pg_dump` backup cron
