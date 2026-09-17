#!/usr/bin/env bash
# Nightly PostgreSQL backup for HexNation (mirrors planner/scripts/backup-db.sh).
#
# Dumps the compose postgres service, gzips it, keeps KEEP_DAYS days locally,
# and - if RCLONE_REMOTE is set - copies each dump off-box too. Local-only
# backups survive a bad migration or a wiped volume but not a dead droplet;
# set RCLONE_REMOTE (e.g. "spaces:hexnation-backups", after `rclone config`)
# for real disaster recovery.
#
# Usage:
#   ./scripts/backup-db.sh
#   KEEP_DAYS=14 ./scripts/backup-db.sh
#   RCLONE_REMOTE=spaces:hexnation-backups ./scripts/backup-db.sh
#
# Cron (nightly at 03:15, after planner's 02:00/03:00 jobs on the same box):
#   15 3 * * * cd /root/realmwar && ./scripts/backup-db.sh >> /var/log/hexnation-backup.log 2>&1
#
# Restore (into a fresh/empty database):
#   gunzip -c ~/hexnation-backups/hexnation_YYYYMMDD_HHMMSS.sql.gz \
#     | docker compose exec -T postgres psql -U realmwar realmwar

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/home/$(whoami)/hexnation-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMPOSE=(docker compose -f "$PROJECT_ROOT/docker-compose.yml")

# Same defaults as docker-compose.yml, overridable from .env
POSTGRES_DB=realmwar
POSTGRES_USER=realmwar
if [ -f "$PROJECT_ROOT/.env" ]; then
  # shellcheck disable=SC2046
  export $(grep -E '^POSTGRES_(DB|USER)=' "$PROJECT_ROOT/.env" | xargs) 2>/dev/null || true
fi

mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/hexnation_${TIMESTAMP}.sql.gz"

echo "[$(date)] Backing up '$POSTGRES_DB'..."

if ! "${COMPOSE[@]}" ps postgres 2>/dev/null | grep -qE "Up|running"; then
  echo "[$(date)] ERROR: postgres container is not running (docker compose up -d postgres)" >&2
  exit 1
fi

if "${COMPOSE[@]}" exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$BACKUP_FILE"; then
  echo "[$(date)] Backup complete: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
else
  echo "[$(date)] ERROR: pg_dump failed" >&2
  rm -f "$BACKUP_FILE"
  exit 1
fi

if [ -n "$RCLONE_REMOTE" ]; then
  if command -v rclone >/dev/null 2>&1; then
    if rclone copy "$BACKUP_FILE" "$RCLONE_REMOTE/"; then
      echo "[$(date)] Copied off-box to $RCLONE_REMOTE"
    else
      echo "[$(date)] WARNING: off-box copy to $RCLONE_REMOTE failed - local backup kept" >&2
    fi
  else
    echo "[$(date)] WARNING: RCLONE_REMOTE set but rclone not installed - local backup only" >&2
  fi
fi

DELETED=$(find "$BACKUP_DIR" -name "hexnation_*.sql.gz" -mtime +"$KEEP_DAYS" -print -delete | wc -l)
[ "$DELETED" -gt 0 ] && echo "[$(date)] Removed $DELETED backup(s) older than $KEEP_DAYS days"

echo "[$(date)] Done. Recent backups:"
ls -lh "$BACKUP_DIR"/hexnation_*.sql.gz 2>/dev/null | tail -5
