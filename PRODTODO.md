# Production status

**Live at https://hexnation.app since 2026-09-17.** Deployment, verification, and backups are documented in `server/DEPLOY.md`. This file tracks only what's still open.

## Done at launch (kept for the record)

- Boot guards under `MODE=prod` (real secrets, `CLIENT_ORIGIN`), CORS locked, admin routes rate-limited with timing-safe compare, `helmet`, rate limiter keyed off `req.ip` behind `TRUST_PROXY=1`
- Privacy Policy + Terms in-app, 16+ age gate, data export (`GET /api/players/export`), account deletion (`DELETE /api/players/me`, anonymises in place), OSM/OpenFreeMap attribution
- Fog of war enforced server-side (`server/visibility.js`) - hexes, buildings, armies, battles; no unredacted public dump
- Case-insensitive username uniqueness (`players_username_lower_idx`)
- Docker Compose + Cloudflare Tunnel deploy, GHCR images with automatic untagged-version pruning, `scripts/backup-db.sh`
- Mobile: Pixel-7 e2e coverage, safe-area/`dvh` layout, 16px inputs on phones, `overscroll-behavior`

## Open

### Ops
- [ ] **Install the backup cron on the droplet** (`server/DEPLOY.md` → Backups) and set `RCLONE_REMOTE` to a DO Space for off-box copies - local dumps don't survive the droplet dying.
- [ ] **Push notifications**: generate VAPID keys (`npx web-push generate-vapid-keys`), add to the droplet `.env`, `docker compose up -d backend`. Currently disabled; the client no longer prompts for permission when it's unconfigured.
- [ ] Confirm the `privacy@hexnation.app` mailbox exists (it's what the Privacy Policy tells people to contact).
- [ ] Decide nginx access-log retention (IPs are personal data). Tunnel + container logs only today.
- [ ] Stop `planner-dev` on the shared droplet if CPU contention appears (`docker stats`), before resizing.
- [ ] Keep chat **off** (`CHAT_ENABLED` unset) until there's a moderation/report flow.
- [ ] Know the GDPR 72-hour breach-notification duty if EU users are affected.

### Code
- [ ] Server deps carry transitive advisories inside `express`/`socket.io` (`qs`, `path-to-regexp`, `ws`, `engine.io`) that `npm audit fix` can't clear - re-check after upstream releases.
- [ ] Test gaps: no unit tests for `auth`, `ratelimit`, `season`, `socket`, `marchPath`, `bots`, `notify`; no client unit tests (e2e only).
- [ ] `GameMap.jsx` is ~2,700 lines and where most recent bugs lived - split out the topbar and the army/battle overlay effects when next touched.
- [ ] Night tint is only on the `hexes` source (the individual-hex detail view); the low-zoom `overview-hexes` layer has none. Deliberately deferred - the topbar sun/moon is the primary signal.
- [ ] Password reset: no email is collected, so there's no recovery path today (backlog since 2026-09-09).
