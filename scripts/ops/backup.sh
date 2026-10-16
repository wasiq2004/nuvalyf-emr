#!/usr/bin/env bash
# Nightly backup of the NuvaLyf database (custom format, compressed).
#
#   scripts/ops/backup.sh [output-dir]
#
# Run next to docker-compose.yml. COMPOSE_PROJECT_NAME selects the stack
# (default medflow-emr). Keep at least 30 daily copies off the server; see
# docs/OPERATIONS.md for retention and the restore drill.
set -euo pipefail

OUT="${1:-./backups}"
PROJECT="${COMPOSE_PROJECT_NAME:-medflow-emr}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-medflow}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT/medflow-$STAMP.dump"

mkdir -p "$OUT"
docker compose -p "$PROJECT" exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom --compress=9 > "$FILE"
# A dump that cannot be listed is not a backup.
docker compose -p "$PROJECT" exec -T db pg_restore --list < "$FILE" > /dev/null
echo "Backup written: $FILE ($(du -h "$FILE" | cut -f1))"
