#!/usr/bin/env bash
# Evidence that this server keeps logs for at least 180 days (CERT-In
# directions, 28 April 2022). Prints what is configured and how far back the
# logs actually go, and exits non-zero if the setting falls short.
#
#   scripts/ops/check-log-retention.sh [minimum-days]   (default 180)
#
# Run on the host, after switching to docker-compose.logging.yml.
set -uo pipefail

MIN_DAYS="${1:-180}"
problems=0
say() { printf '%-34s %s\n' "$1" "$2"; }
bad() { say "$1" "$2  <-- needs attention"; problems=$((problems + 1)); }

command -v journalctl > /dev/null || { echo "journalctl not found: this host does not use systemd-journald." >&2; exit 2; }

# The setting systemd will actually use, after every drop-in file.
CONFIG="$(systemd-analyze cat-config systemd/journald.conf 2> /dev/null || cat /etc/systemd/journald.conf 2> /dev/null)"
value() { grep -E "^[[:space:]]*$1=" <<< "$CONFIG" | tail -1 | cut -d= -f2- | tr -d '[:space:]'; }

storage="$(value Storage)"
retention="$(value MaxRetentionSec)"
max_use="$(value SystemMaxUse)"

[[ "$storage" == "persistent" ]] && say "Storage" "$storage" || bad "Storage" "${storage:-auto (lost on reboot if /var/log/journal is missing)}"

# MaxRetentionSec: plain seconds, or a number with s/min/h/day/week/month/year.
to_days() {
  local v="$1" n unit
  n="$(sed -E 's/^([0-9]+).*/\1/' <<< "$v")"
  unit="$(sed -E 's/^[0-9]+//' <<< "$v")"
  case "$unit" in
    "" | s | sec) echo $((n / 86400)) ;;
    min | m) echo $((n / 1440)) ;;
    h | hour | hours) echo $((n / 24)) ;;
    d | day | days) echo "$n" ;;
    w | week | weeks) echo $((n * 7)) ;;
    month | months) echo $((n * 30)) ;;
    y | year | years) echo $((n * 365)) ;;
    *) echo 0 ;;
  esac
}
if [[ -z "$retention" ]]; then
  bad "MaxRetentionSec" "not set (entries are dropped by size, not age)"
else
  days="$(to_days "$retention")"
  ((days >= MIN_DAYS)) && say "MaxRetentionSec" "$retention ($days days)" || bad "MaxRetentionSec" "$retention ($days days, under $MIN_DAYS)"
fi
say "SystemMaxUse" "${max_use:-default (10% of the disk): check it holds $MIN_DAYS days}"

# How far back each NuvaLyf service's logs really go.
for service in db web worker setup; do
  first="$(journalctl -t "nuvalyf-$service" -o short-iso --no-pager 2> /dev/null | grep -v '^-- ' | head -1 | cut -d' ' -f1)"
  say "Oldest nuvalyf-$service" "${first:-no entries yet}"
done

if ((problems > 0)); then
  echo "Log retention does not yet meet $MIN_DAYS days. See docs/OPERATIONS.md, \"Logs\"."
  exit 1
fi
echo "Log retention is configured for at least $MIN_DAYS days."
