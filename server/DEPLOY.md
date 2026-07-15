# Deploying RealmWar

Single-droplet deployment: nginx (TLS + reverse proxy) → Node server (systemd) → PostgreSQL, with the client served as static files by nginx. Assumes Ubuntu 22.04+.

## 1. Provision

```bash
apt update && apt install -y nginx postgresql certbot python3-certbot-nginx
# Node 20+ via nodesource or nvm
```

## 2. Database

```bash
sudo -u postgres createuser realmwar -P        # pick a strong password
sudo -u postgres createdb realmwar -O realmwar
psql -U realmwar -d realmwar -f server/schema.sql
```

`schema.sql` is the base schema; the server's `runMigrations()` adds the rest
(`world_events`, `seasons`, `alliances`, `hex_history`, ...) on first boot. Boot the
server once and check for `[db] Migrations complete` before pointing traffic at it.

## 3. Server environment

`/opt/realmwar/server/.env`:

```bash
NODE_ENV=production
DEV_MODE=false                  # required - boot refuses prod with dev balance
DATABASE_URL=postgresql://realmwar:<password>@localhost:5432/realmwar
JWT_SECRET=<openssl rand -base64 32>
ADMIN_SECRET=<openssl rand -base64 32>
CLIENT_ORIGIN=https://yourdomain.com
TRUST_PROXY=1                   # nginx is one hop in front
PORT=3001
# Web push (optional but recommended - it's the retention hook)
VAPID_PUBLIC_KEY=...            # npx web-push generate-vapid-keys
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@yourdomain.com
```

The server **refuses to start** under `NODE_ENV=production` if `DEV_MODE` isn't
`false`, if `JWT_SECRET`/`ADMIN_SECRET` are placeholders, or if `CLIENT_ORIGIN`
is unset. That's intentional: fix the env, don't bypass the check.

## 4. systemd unit

`/etc/systemd/system/realmwar.service`:

```ini
[Unit]
Description=RealmWar game server
After=network.target postgresql.service

[Service]
Type=simple
User=realmwar
WorkingDirectory=/opt/realmwar/server
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now realmwar
journalctl -u realmwar -f      # watch boot: migrations, tick start
```

## 5. Client build

```bash
cd client
cat > .env.production <<EOF
VITE_MAPBOX_TOKEN=<your token>
VITE_API_URL=https://yourdomain.com
VITE_SOCKET_URL=https://yourdomain.com
EOF
npm ci && npm run build         # → dist/
cp -r dist/* /var/www/realmwar/
```

## 6. nginx

```nginx
server {
    server_name yourdomain.com;

    root /var/www/realmwar;
    index index.html;

    location / {
        try_files $uri /index.html;      # SPA fallback
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Host $host;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

```bash
certbot --nginx -d yourdomain.com   # TLS; push notifications require HTTPS
```

## 7. Go-live verification

```bash
curl -s https://yourdomain.com/api/health
# → {"ok":true,"devMode":false,"tick_interval_ms":600000,...}
```

- [ ] `devMode: false` and `tick_interval_ms: 600000` in `/api/health`
- [ ] Register a test account: starts with 100 gold / 20 troops (not 9999/50)
- [ ] Admin portal (`https://yourdomain.com/#admin`) rejects a wrong secret
- [ ] `curl -H "Origin: https://evil.example" -i .../api/health` has no `Access-Control-Allow-Origin` echo
- [ ] Push opt-in works from the dispatches panel (needs HTTPS + VAPID keys)
- [ ] `journalctl -u realmwar` is quiet between ticks (no per-battle spam)

## Operations notes

- **Backups**: `pg_dump realmwar` on a daily cron; the world is one database.
- **Rate limits** are per-process and in-memory: fine for one instance, revisit
  before scaling horizontally (the tick engine also assumes a single process).
- **Season length** is 90 days in prod (`SEASON_DURATION_MS`); ending a season
  early is `POST /api/admin/season/end` with the admin secret.
- **Bots**: 6 bots + Wildlands camps self-seed on first tick; `POST /api/admin/bots/reset` re-seeds.
