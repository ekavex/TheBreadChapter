#!/bin/sh
# Nightly database backup.
#
# Run by the `backup` service in docker-compose.yml, or manually:
#   docker compose exec backup sh /usr/local/bin/backup-db.sh
#
# Writes a compressed custom-format dump (restorable selectively with
# pg_restore) to /backups and prunes dumps older than BACKUP_RETENTION_DAYS.
#
# RESTORE (destructive - read twice before running):
#   docker compose stop app
#   docker compose exec -T db pg_restore -U breaduser -d breadchapter --clean --if-exists < backups/<file>.dump
#   docker compose start app

set -eu

DB_HOST="${DB_HOST:-db}"
DB_USER="${DB_USER:-breaduser}"
DB_NAME="${DB_NAME:-breadchapter}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_DIR/${DB_NAME}-${STAMP}.dump"

echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"event\":\"backup.start\",\"target\":\"$TARGET\"}"

# Custom format (-Fc) is compressed and supports partial restore.
pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -Fc -f "$TARGET"

# A dump that cannot be listed is not a backup - verify before trusting it.
if ! pg_restore --list "$TARGET" >/dev/null 2>&1; then
  echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"level\":\"error\",\"event\":\"backup.verify_failed\",\"target\":\"$TARGET\"}"
  rm -f "$TARGET"
  exit 1
fi

SIZE="$(wc -c < "$TARGET" | tr -d ' ')"
echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"event\":\"backup.ok\",\"target\":\"$TARGET\",\"bytes\":$SIZE}"

# Prune old dumps.
find "$BACKUP_DIR" -name "${DB_NAME}-*.dump" -type f -mtime "+${RETENTION_DAYS}" -print -delete \
  | while read -r old; do
      echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"event\":\"backup.pruned\",\"file\":\"$old\"}"
    done
