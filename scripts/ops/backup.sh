#!/usr/bin/env bash
# Nightly backup of the NuvaLyf database, encrypted before it touches disk.
#
#   BACKUP_PUBLIC_KEY=/etc/nuvalyf/backup-public.asc scripts/ops/backup.sh [output-dir]
#
# The dump streams straight into GnuPG and is written only as
# medflow-<time>.dump.gpg (OpenPGP, AES-256), with a .sha256 beside it. It is
# encrypted to a public key: the server can make backups but cannot read them.
# The private key is kept off the server (docs/OPERATIONS.md, "Backups").
#
# Run next to docker-compose.yml. COMPOSE_PROJECT_NAME selects the stack
# (default medflow-emr). Keep at least 30 daily copies off the server.
set -euo pipefail

OUT="${1:-./backups}"
PROJECT="${COMPOSE_PROJECT_NAME:-medflow-emr}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-medflow}"
KEY="${BACKUP_PUBLIC_KEY:-}"

fail() {
  echo "backup: $*" >&2
  exit 1
}

# Never a plain-text backup: refuse rather than fall back.
[[ -n "$KEY" ]] || fail "BACKUP_PUBLIC_KEY is not set. Backups are only written encrypted; see docs/OPERATIONS.md."
[[ -r "$KEY" ]] || fail "cannot read the public key at $KEY"
command -v gpg > /dev/null || fail "gpg is not installed (apt install gnupg)"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT/medflow-$STAMP.dump.gpg"
PART="$FILE.part"
mkdir -p "$OUT"
umask 077

# A throwaway GnuPG home: nothing is imported into any keyring, and no
# private key is needed, or present, on this server.
GPG_HOME="$(mktemp -d)"
STATUS="$(mktemp)"
rm -f "$STATUS"
cleanup() {
  gpgconf --homedir "$GPG_HOME" --kill all > /dev/null 2>&1 || true
  rm -rf "$GPG_HOME" "$PART" "$STATUS"
}
trap cleanup EXIT

# The recipient must be a public key. A private key here would mean the
# server could read its own backups, which defeats the point.
KEYS="$(gpg --homedir "$GPG_HOME" --batch --quiet --show-keys --with-colons "$KEY" 2> /dev/null || true)"
if grep -q '^sec' <<< "$KEYS"; then
  fail "$KEY contains a private key. Keep the private key off the server and point BACKUP_PUBLIC_KEY at the public key only."
fi
grep -q '^pub' <<< "$KEYS" || fail "$KEY is not an OpenPGP public key"

dump() { docker compose -p "$PROJECT" exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom --compress=9; }
# A dump that cannot be listed is not a backup: the same stream is checked as it is written.
check() { docker compose -p "$PROJECT" exec -T db pg_restore --list > /dev/null; }

if ! dump | tee >(check; echo $? > "$STATUS") |
  gpg --homedir "$GPG_HOME" --batch --yes --quiet --trust-model always \
    --recipient-file "$KEY" --cipher-algo AES256 --compress-algo none \
    --output "$PART" --encrypt; then
  fail "the dump could not be read back; nothing was kept"
fi

for _ in $(seq 1 600); do
  [[ -s "$STATUS" ]] && break
  sleep 0.1
done
[[ "$(cat "$STATUS" 2> /dev/null)" == "0" ]] || fail "the dump could not be read back; nothing was kept"
[[ -s "$PART" ]] || fail "the encrypted file is empty; nothing was kept"

mv "$PART" "$FILE"
(cd "$OUT" && sha256sum "$(basename "$FILE")" > "$(basename "$FILE").sha256")
echo "Backup written: $FILE ($(du -h "$FILE" | cut -f1)), encrypted to $(gpg --homedir "$GPG_HOME" --batch --quiet --show-keys --with-colons "$KEY" 2> /dev/null | awk -F: '/^uid/ {print $10; exit}')"
