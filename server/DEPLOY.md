# Deploying HexNation

How `hexnation.app` actually runs: **Docker Compose on a shared DigitalOcean droplet, reached through a Cloudflare Tunnel.** No host nginx, no systemd unit, no exposed ports. It shares the droplet with CalendarChef (`planner/`), so every host port here is distinct from planner's and bound to `127.0.0.1`.

```
git push main ──► GitHub Actions ──► ghcr.io/pjj-22/realm-war/{backend,frontend}:latest
                                              │  (untagged old versions auto-pruned)
                 droplet: ./deploy.sh  ◄───────┘   docker compose pull + up
Internet ──► Cloudflare ──► Tunnel ──► localhost:8480 frontend (nginx)
                                          ├─ /api/, /socket.io/ ──► backend:3001
                                          └─ postgres:5432 (host 127.0.0.1:5434)
```

| Service | Image | Host port |
|---|---|---|
| frontend (nginx, static build, proxies `/api` + `/socket.io`) | `ghcr.io/pjj-22/realm-war/frontend` | 127.0.0.1:8480 |
| backend (Node) | `ghcr.io/pjj-22/realm-war/backend` | 127.0.0.1:8481 |
| postgres 15 | `postgres:15-alpine` | 127.0.0.1:5434 |

Nothing deploys to the droplet automatically - CI publishes images, `./deploy.sh` on the box pulls them.

## Routine deploy

```bash
ssh calendarchef            # the droplet (see ~/.ssh/config)
cd ~/realmwar && ./deploy.sh
docker compose logs backend --tail 30   # expect "[db] Migrations complete" then "[tick] Starting"
```

`deploy.sh` only pulls images. Run `git pull` first **only** if `docker-compose.yml`, `deploy.sh`, `scripts/`, or `server/schema.sql` changed - those aren't baked into images.

## First-time setup (done 2026-09-17; here for a rebuild)

1. **Deploy key** - GitHub deploy keys are one-key-per-repo, so this repo has its own:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/realmwar_deploy -C "realmwar-deploy" -N ""
   printf 'Host github-realmwar\n    HostName github.com\n    User git\n    IdentityFile ~/.ssh/realmwar_deploy\n    IdentitiesOnly yes\n' >> ~/.ssh/config
   cat ~/.ssh/realmwar_deploy.pub    # add as a read-only deploy key on pjj-22/realm-war
   git clone git@github-realmwar:pjj-22/realm-war.git ~/realmwar
   ```
2. **Secrets** - `cd ~/realmwar && cp .env.example .env`, then fill `JWT_SECRET`, `ADMIN_SECRET`, `POSTGRES_PASSWORD`.
   - `JWT_SECRET`/`ADMIN_SECRET`: `openssl rand -base64 32`
   - `POSTGRES_PASSWORD`: **`openssl rand -hex 24`** - it's interpolated into a `postgresql://` URL, and a `/` or `+` from base64 breaks URL parsing (`ERR_INVALID_URL`, backend crash-loops).
   - `MODE=prod`, `CLIENT_ORIGIN=https://hexnation.app`, `TRUST_PROXY=1` are already the defaults there.
3. **Start** - `docker compose pull && docker compose up -d`. `server/schema.sql` seeds a fresh volume via `docker-entrypoint-initdb.d`; `runMigrations()` in `index.js` adds everything since, on every boot.
4. **Tunnel** - add to `/etc/cloudflared/config.yml` **above** the `- service: http_status:404` catch-all (rules are ordered; anything after the catch-all never matches):
   ```yaml
   - hostname: hexnation.app
     service: http://localhost:8480
   ```
   then `systemctl restart cloudflared`. Cloudflare terminates TLS; `.app` is HSTS-preloaded so HTTPS is mandatory anyway.
5. **DNS** - Cloudflare zone `hexnation.app`: `CNAME @ → <tunnel-id>.cfargotunnel.com`, proxied.
6. **Firewall** - `ufw` already allows only SSH; the tunnel is outbound-only, so nothing else opens.

## Go-live verification

```bash
curl -s https://hexnation.app/api/health         # "mode":"prod","devMode":false,"tick_interval_ms":600000
curl -s -o /dev/null -w "%{http_code}\n" -H "x-admin-secret: wrong" https://hexnation.app/api/admin/stats   # 403
curl -si -H "Origin: https://evil.example" https://hexnation.app/api/health | grep -i access-control   # nothing echoed
```
Register a test account: 100 gold / 20 troops (not 9999/50 = dev sandbox).

## Backups

`scripts/backup-db.sh` dumps the compose postgres, gzips, keeps 14 days locally, and copies off-box if `RCLONE_REMOTE` is set. Install the nightly job once:

```bash
crontab -e
15 3 * * * cd /root/realmwar && ./scripts/backup-db.sh >> /var/log/hexnation-backup.log 2>&1
```
Local-only dumps survive a bad migration or wiped volume, **not a dead droplet** - configure `rclone` to a DO Space (or any S3) and set `RCLONE_REMOTE` for real disaster recovery. Restore: `gunzip -c <file> | docker compose exec -T postgres psql -U realmwar realmwar`.

## Operations notes

- **Push notifications** need `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` in `.env` (`npx web-push generate-vapid-keys`), then `docker compose up -d backend`. Unset = push silently disabled; the client detects this and won't prompt for permission.
- **Rate limits are per-process/in-memory**, and `tick.js` assumes a single backend process - don't scale `backend` horizontally without reworking both.
- **Shared CPU**: the droplet is 1 vCPU / 2GB with planner's prod+dev stacks. If contention shows up (`docker stats`), stop `planner-dev` (`cd ~/planner-dev && docker compose --profile prod down`) before paying to resize.
- **nginx `client_max_body_size`** is the 1MB default - fine for this API; both oversized-payload incidents (socket.io `watch-regions` and `POST /hexes/viewport` at low zoom) were fixed client-side, and express's JSON limit is 256kb.
- **nginx `mime.types` has no `.mjs` entry.** Anything emitted with that extension goes out as `application/octet-stream`, which Firefox refuses to run as a worker/module (Chromium is lenient, so it looks fine there) - this is how the MapLibre 6 worker shipped a black map once. `client/nginx.conf` has a dedicated `location ~* \.mjs$` (the worker is now bundled to `.js` via `?worker&url`, so the rule is belt-and-braces), and the Deploy workflow smoke-tests every built JS asset's content-type out of the real image before pushing - CI's e2e runs on `vite preview`, whose own MIME table won't catch this.
- **Season** is 90 days in prod; end early with `POST /api/admin/season/end` (`x-admin-secret`). Bots + Wildlands camps self-seed on first tick.
- **Terminal gotcha**: the droplet's SSH session mangles multi-line pastes (nano auto-indent, wrapped long lines). Prefer short single commands / `sed -i`, and `cat -A` a config before restarting the service that reads it.
