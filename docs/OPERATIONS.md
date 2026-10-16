# NuvaLyf operations

How to deploy, back up, monitor and scale NuvaLyf. For the security model see [SECURITY.md](SECURITY.md).

## Deploying

### Requirements

- A Linux host with Docker and Docker Compose v2. 2 vCPU and 4 GB RAM is plenty for a single clinic or a small group (see [load test](#load-test)).
- A domain name and a TLS-terminating reverse proxy (Caddy, nginx or a cloud load balancer). NuvaLyf must be served over https in production.
- Encrypted disk for the database volume and backups.

### First install

```bash
git clone <repo> medflow && cd medflow
cp .env.example .env
```

In `.env`, set:

| Variable | Value |
| --- | --- |
| `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `PLATFORM_DB_PASSWORD`, `PROVISIONER_DB_PASSWORD` | Four different long random passwords |
| `AUTH_SECRET`, `PLATFORM_AUTH_SECRET` | `openssl rand -base64 32`, different from each other |
| `DATA_ENCRYPTION_KEY` | `openssl rand -base64 32`. **Back this up separately**: without it, stored WhatsApp tokens cannot be read |
| `AUTH_URL` | `https://your-domain` |
| `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD` | The first Super Admin (12+ characters). Remove the password from `.env` after the first start |
| `WHATSAPP_DRIVER` | `cloud`, or `log` until Meta business verification is done |
| `TRUST_PROXY_HOPS` | Number of proxies in front of the app that append to `X-Forwarded-For` (1 for a single Caddy/nginx; 2 for a cloud LB in front of nginx) |

Then:

```bash
docker compose up --build -d
docker compose ps            # setup: exited (0); db, web, worker: running
curl -s localhost:3000/api/health
```

Bind the app to localhost and let the proxy publish it. A minimal Caddy config:

```
clinic.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Set `WEB_PORT` if 3000 is taken. Keep the database port mapping on `127.0.0.1` (the default), or remove it entirely.

### Upgrading

```bash
scripts/ops/backup.sh                # always back up first
git pull
docker compose up --build -d         # setup re-runs migrations; idempotent
curl -s localhost:3000/api/health
```

Migrations only move forward. To roll back a bad release, restore the pre-upgrade backup into a new database ([below](#restoring)) and run the previous release against it.

### Rotating secrets

| Secret | Effect of rotating |
| --- | --- |
| `AUTH_SECRET` / `PLATFORM_AUTH_SECRET` | Everyone on that panel is signed out. Safe at any time |
| Database role passwords | Change in `.env`, then `docker compose up -d`; `setup` updates the roles |
| `DATA_ENCRYPTION_KEY` | Stored WhatsApp tokens become unreadable; each clinic re-enters its token in **Settings → Messaging** |

## Backups

`scripts/ops/backup.sh` writes a compressed `pg_dump` (custom format) and checks it can be listed. Run it next to `docker-compose.yml`.

**Schedule:** nightly, plus before every upgrade. Example crontab:

```
30 1 * * *  cd /srv/medflow && scripts/ops/backup.sh /srv/backups >> /var/log/medflow-backup.log 2>&1
```

**Retention:** keep 30 daily and 12 monthly copies, and copy every backup **off the server** (object storage with versioning or a second site), encrypted. Clinical records generally have multi-year legal retention; follow local regulation for how long monthly copies are kept. Remove old local files with, for example, `find /srv/backups -name 'medflow-*.dump' -mtime +30 -delete`.

`DATA_ENCRYPTION_KEY` and `.env` are not in the dump. Store them in a password manager or secrets vault.

### Restoring

Never restore over the live database. Restore into a new one, verify, then switch:

```bash
scripts/ops/restore.sh /srv/backups/medflow-20261016T013000Z.dump medflow_restored
npm run ops:verify-restore -- medflow_restored     # compares with the live DB
# then set POSTGRES_DB / the connection strings to medflow_restored and
docker compose up -d
```

`ops:verify-restore` runs from the checkout on the host (Node 22 and `npm ci` needed once). It reads `DATABASE_OWNER_URL` and `DATABASE_URL` from `.env`, pointed at `127.0.0.1:${DB_PORT}`. It checks row counts for every table, the migration history, that row-level security is on for every clinic table, that every guard trigger is present, that the audit trail is still append-only, and that the app role sees no patient rows without a clinic context.

### Restore drill

Run the drill **every quarter** and after any infrastructure change: restore last night's backup into a scratch database, run `ops:verify-restore`, record the result, drop the scratch database.

Drill on 2026-10-16 (dev data):

```
✓ 62 tables, identical row counts (2335 rows)
✓ 14 schema migrations recorded
✓ row-level security enabled on every clinic table
✓ 26 guard triggers (audit, immutability, ledger) present
✓ audit trail is append-only
✓ app role sees no patient rows without a clinic context
Restore drill passed.
```

## Monitoring

### Health endpoint

`GET /api/health` needs no authentication and exposes no internals:

```json
{ "status": "ok", "database": "ok", "worker": "ok", "workerLastSeenSeconds": 42 }
```

| Field | Alert when |
| --- | --- |
| HTTP status | `503` (database unreachable) or no response: **page someone** |
| `worker` | `stale` (no pass for 5 minutes) or `never-seen` with WhatsApp enabled: reminders are not going out. Check `docker compose logs worker` |

Point an uptime monitor (UptimeRobot, Better Stack, a cloud LB health check) at it every minute. Load balancers should use it as the readiness check; a stale worker does not take the web app out of rotation.

### What else to watch

| Signal | Where | Why |
| --- | --- | --- |
| Disk usage of the database volume and backup directory | Host monitoring | Postgres stops when the disk is full |
| Nightly backup log | `/var/log/medflow-backup.log` | A missing or failed line means no backup |
| Critical audit events | Compliance panel → **Summary** (Clinic Admin / Auditor) | Repeated access refusals or failed sign-ins |
| Failed WhatsApp messages | **Broadcasts** (per clinic) | Bad token, template not approved, or Meta outage |
| Container restarts | `docker compose ps` | Crash loops |

### Logs

Containers log to stdout. Compose rotates each service's log at 20 MB × 10 files (about 200 MB per service), so roughly the last few weeks are kept on the host. For longer retention, ship logs to a central store (Loki, CloudWatch, Datadog) using a Docker logging driver, and keep them **90 days**.

Server logs do not contain patient data: database errors are logged without their parameters. The authoritative record of who did what is the audit trail in the database, which is append-only and kept with the backups for as long as the clinical record.

## Scaling

- **Web:** stateless. Run more `web` replicas behind the load balancer; sessions are signed cookies and rate limits live in Postgres.
- **Worker:** run one; extra replicas wait on an advisory lock and take over if the active one dies.
- **Database:** the bottleneck. Each web instance opens up to `DATABASE_POOL_MAX` (default 10) connections per role, so keep `replicas × 3 × pool` below Postgres's `max_connections` (100 by default) or add PgBouncer in transaction mode.

## Load test

`npm run load:clinic-day -- <patients> <concurrency>` creates a throwaway database (`medflow_load`), onboards a clinic with 8 doctors, 4 nurses and a receptionist, and pushes every patient through the full visit: register → walk-in → triage and vitals → hand over → call → notes → diagnosis → prescription (with interaction and allergy checks) → sign → invoice → payment. Six staff screens poll the queue throughout.

Results on 2026-10-16 (8-core laptop, Postgres 16 in Docker, service layer only, so add a few milliseconds per screen for rendering):

| Profile | Visits | Throughput | Failures | Slowest step p95 |
| --- | --- | --- | --- | --- |
| Busy clinic: 16 visits in flight | 400 | 30.5 visits/s | 0 | 107 ms (sign, invoice) |
| Stress: 40 visits in flight | 2,000 | 35.7 visits/s | 0 | 203 ms (sign & finalise) |

Per-step latency at 40 in flight (ms):

| Step | p50 | p95 | max |
| --- | --- | --- | --- |
| Queue read (polling) | 50 | 70 | 180 |
| Register patient | 51 | 72 | 921 |
| Walk-in | 62 | 80 | 155 |
| Start triage | 50 | 66 | 144 |
| Record vitals | 74 | 96 | 172 |
| Hand over | 49 | 65 | 140 |
| Call patient | 74 | 96 | 165 |
| Open consultation | 47 | 62 | 129 |
| Save notes | 37 | 50 | 107 |
| Add diagnosis | 74 | 96 | 171 |
| Prescribe (with checks) | 148 | 190 | 256 |
| Sign & finalise | 158 | 203 | 267 |
| Create invoice | 153 | 197 | 297 |
| Record payment | 99 | 126 | 196 |

A very busy clinic sees around 300 visits a day, under one every 90 seconds at peak. The stress run completes 2,000 visits in under a minute.

The load test found one real problem: invoice numbering held the per-clinic counter lock for the whole transaction, so concurrent billing queued (p95 3.6 s at 40 in flight). Invoices now take their number as the last step, which brought it down to 0.2 s.
