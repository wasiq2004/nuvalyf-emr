#!/usr/bin/env bash
# Restore a backup into a NEW database (never over the live one).
#
#   scripts/ops/restore.sh <backup.dump> <target-database>
#
# Then verify it:  npm run ops:verify-restore -- <target-database>
# and, once satisfied, point POSTGRES_DB / the connection strings at it.
set -euo pipefail

FILE="${1:?backup file}"
TARGET="${2:?target database name}"
PROJECT="${COMPOSE_PROJECT_NAME:-medflow-emr}"
DB_USER="${POSTGRES_USER:-postgres}"

if [[ ! "$TARGET" =~ ^[a-z][a-z0-9_]{1,40}$ ]]; then
  echo "Target database name must be lowercase letters, digits and underscores." >&2
  exit 1
fi

docker compose -p "$PROJECT" exec -T db createdb -U "$DB_USER" "$TARGET"
docker compose -p "$PROJECT" exec -T db pg_restore -U "$DB_USER" -d "$TARGET" --exit-on-error < "$FILE"
echo "Restored $FILE into database $TARGET"
