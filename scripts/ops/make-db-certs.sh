#!/usr/bin/env bash
# Certificates for TLS between NuvaLyf and its database.
#
#   scripts/ops/make-db-certs.sh [output-dir] [extra-hostname...]
#
# Writes, into ./certs by default:
#   ca.crt / ca.key        a private certificate authority for this deployment
#   server.crt / server.key  the database's certificate, signed by that CA,
#                          naming "db" (its name on the Docker network) and
#                          localhost, plus any extra hostnames given
#
# The app trusts only ca.crt (DATABASE_SSL_CA), so it will not talk to a
# database that cannot prove it holds server.key. Keep ca.key off the server
# once the certificates are made; it is only needed to make new ones.
set -euo pipefail
# OpenSSL prints progress noise on success; on failure, say so instead of
# leaving half a set of files behind.
LOG="$(mktemp)"
trap 'echo "make-db-certs: failed:" >&2; cat "$LOG" >&2; rm -f "$LOG"' ERR
trap 'rm -f "$LOG"' EXIT

OUT="${1:-./certs}"
shift || true
command -v openssl > /dev/null || { echo "openssl is not installed" >&2; exit 1; }

if [[ -e "$OUT/server.key" ]]; then
  echo "$OUT/server.key already exists. Move the old certificates away first." >&2
  exit 1
fi
mkdir -p "$OUT"
umask 077

SAN="DNS:db,DNS:localhost,IP:127.0.0.1"
for host in "$@"; do SAN="$SAN,DNS:$host"; done

openssl req -x509 -new -nodes -newkey rsa:4096 -sha256 -days 3650 \
  -subj "/CN=NuvaLyf database CA" -keyout "$OUT/ca.key" -out "$OUT/ca.crt" 2> "$LOG"
openssl req -new -nodes -newkey rsa:2048 -sha256 \
  -subj "/CN=db" -keyout "$OUT/server.key" -out "$OUT/server.csr" 2> "$LOG"
printf 'subjectAltName=%s\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$SAN" > "$OUT/server.ext"
openssl x509 -req -in "$OUT/server.csr" -CA "$OUT/ca.crt" -CAkey "$OUT/ca.key" -CAcreateserial \
  -days 825 -sha256 -extfile "$OUT/server.ext" -out "$OUT/server.crt" 2> "$LOG"
rm -f "$OUT/server.csr" "$OUT/server.ext" "$OUT/ca.srl"
chmod 644 "$OUT/ca.crt" "$OUT/server.crt"
chmod 600 "$OUT/ca.key" "$OUT/server.key"

echo "Certificates written to $OUT (server certificate valid 825 days, for $SAN)."
echo "Move $OUT/ca.key somewhere safe off the server; it is not needed to run."
