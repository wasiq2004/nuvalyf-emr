#!/usr/bin/env bash
# Restore a backup into a NEW database (never over the live one).
#
#   scripts/ops/restore.sh <backup.dump.gpg> <target-database>
#
# An encrypted backup (.gpg) is decrypted with the backup private key, which
# must be in the GnuPG keyring of whoever runs this (docs/OPERATIONS.md,
# "Backups"). The checksum beside it is checked first, and decryption fails
# if a single byte of the file was changed.
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

read_backup() {
  if [[ "$FILE" == *.gpg ]]; then
    gpg --batch --quiet --decrypt "$FILE"
  else
    echo "Warning: $FILE is not encrypted." >&2
    cat "$FILE"
  fi
}

if [[ -f "$FILE.sha256" ]]; then
  (cd "$(dirname "$FILE")" && sha256sum --check --quiet "$(basename "$FILE").sha256") || {
    echo "Checksum does not match: the file was changed or damaged." >&2
    exit 1
  }
fi

docker compose -p "$PROJECT" exec -T db createdb -U "$DB_USER" "$TARGET"
read_backup | docker compose -p "$PROJECT" exec -T db pg_restore -U "$DB_USER" -d "$TARGET" --exit-on-error
echo "Restored $FILE into database $TARGET"
