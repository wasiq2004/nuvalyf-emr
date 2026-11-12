# NuvaLyf operations

How to deploy, back up, monitor and scale NuvaLyf. For the security model see [SECURITY.md](SECURITY.md).

## Deploying

### Requirements

- A Linux host with Docker and Docker Compose v2. 2 vCPU and 4 GB RAM is plenty for a single clinic or a small group (see [load test](#load-test)).
- A domain name and a TLS-terminating reverse proxy (Caddy, nginx or a cloud load balancer). NuvaLyf must be served over https in production. Lab documents are uploaded at up to 10 MB each: nginx needs `client_max_body_size 12m;` (its default is 1 MB). Traefik and Caddy need no change.
- **An encrypted disk** for the database volume, logs and local backups, on a server in India. See [Disk encryption](#disk-encryption).

### First install

```bash
git clone <repo> medflow && cd medflow
cp .env.example .env
scripts/ops/make-db-certs.sh ./certs      # database TLS, see below
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

### Disk encryption

NuvaLyf encrypts clinical notes, lab documents and secrets itself, and backups are encrypted before they reach disk. Patient names, phone numbers, diagnoses, prescriptions and lab values must stay searchable, so the database holds them as they are. **The disk under the database must therefore be encrypted.** It protects everything on it if the disk, a snapshot or the machine is taken. Pick one:

| Hosting | How |
| --- | --- |
| AWS | EBS volumes encrypted (KMS). Turn on "encryption by default" for the region (Mumbai, ap-south-1), so snapshots are encrypted too |
| Azure | Managed disks use server-side encryption by default; add encryption at host for temporary disks (Central India) |
| Google Cloud | Persistent disks are encrypted by default; use a customer-managed key (CMEK) if the auditor asks who holds the key (Mumbai, asia-south1) |
| DigitalOcean, Hetzner, other VPS | Check the provider states volumes are encrypted at rest. If it does not, use the next row |
| Your own server | LUKS (dm-crypt) on the volume holding `/var/lib/docker` and the backup folder, set up when the server is built |

LUKS on a data volume, for example a second disk `/dev/sdb` (this erases it):

```bash
cryptsetup luksFormat --type luks2 /dev/sdb          # choose a long passphrase; store it with the backup key
cryptsetup open /dev/sdb nuvalyf_data
mkfs.ext4 /dev/mapper/nuvalyf_data
mkdir -p /srv/nuvalyf && mount /dev/mapper/nuvalyf_data /srv/nuvalyf
# Move Docker's data root there: in /etc/docker/daemon.json, "data-root": "/srv/nuvalyf/docker"
```

The volume must be unlocked after each reboot (with the passphrase, or a key file on separate storage, or TPM2 with `systemd-cryptenroll`). Record which option you used.

**Evidence for an auditor:** `lsblk -o NAME,TYPE,FSTYPE,MOUNTPOINT` shows `crypt` under the disk, and `cryptsetup status nuvalyf_data` shows the cipher. On a cloud provider, a screenshot or CLI output of the volume's encryption setting. Keep it with the audit file.

### Database TLS

Every connection to the database is encrypted (TLS 1.2 or later) and the app checks the database's certificate. The database refuses any network connection without TLS (`db/pg_hba.conf`). Inside the database container only, backups and the health check use the local socket.

`scripts/ops/make-db-certs.sh ./certs` makes a private certificate authority and a certificate for the database, naming `db` and `localhost`. Then:

- `docker-compose.yml` mounts `certs/server.crt` and `server.key` into the database, and `certs/ca.crt` into `setup`, `web` and `worker`. These run with `DATABASE_SSL=verify-full`.
- Move `certs/ca.key` off the server. It is only needed to make the next certificate.
- The server certificate lasts 825 days. Put the renewal date in the calendar. To renew, move `certs` aside, run the script again, and `docker compose up -d`.
- To reach the database from the host (`ops:verify-restore`, the `db:*` scripts), set `DATABASE_SSL=verify-full` and `DATABASE_SSL_CA=./certs/ca.crt` in `.env`.
- A managed database (RDS, Cloud SQL and others): put its CA certificate in `DATABASE_SSL_CA`. Use `DATABASE_SSL=require` only if the provider gives no CA certificate: that still encrypts, but cannot tell the real server from an impostor.

In production, the app refuses to start if `DATABASE_SSL` is unset. A plain connection needs `DATABASE_SSL=disable` spelled out, and that is not acceptable for a licensed deployment.

Then:

```bash
docker compose up --build -d
docker compose ps            # setup: exited (0); db, web, worker: running
curl -s localhost:3000/api/health
```

`docker-compose.yml` publishes no host ports. On a plain server, `docker compose up` also loads `docker-compose.override.yml`, which publishes the app on `127.0.0.1:3000` (and the database on `127.0.0.1:${DB_PORT}`) for a reverse proxy on the same host. A minimal Caddy config:

```
clinic.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Set `WEB_PORT` if 3000 is taken.

### Deploying with Dokploy

1. Create a **Compose** service from the repository, with compose path `./docker-compose.yml`. Dokploy passes that file explicitly, so the local override (and its host ports) is not used. Port 3000 on the server belongs to Dokploy's own dashboard.
2. Under **Environment**, set the variables from the table above, with `AUTH_URL=https://<your-domain>` and `TRUST_PROXY_HOPS=1` (Traefik).
3. Under **Domains**, add your domain for service **web**, container port **3000**, with HTTPS on. Dokploy's Traefik routes to the container over its network.
4. Deploy. `setup` should exit with code 0, then `web` and `worker` start. Check `https://<your-domain>/api/health`.

Database TLS: Dokploy deploys from the repository, which does not hold the certificates. Make them on the server (`scripts/ops/make-db-certs.sh /etc/nuvalyf/certs`) and set `DB_CERTS_DIR=/etc/nuvalyf/certs` in the project's environment.

Backups: run `scripts/ops/backup.sh` with `COMPOSE_PROJECT_NAME` set to the project name Dokploy shows (for example `nuvalyf-nuvalyf-9mq1ma`), or use Dokploy's scheduled commands.

### The Indian medicine list

`db/reference/indian-medicines.csv.gz` (about 2.5 lakh medicines, 6 MB) ships with the code. `db:migrate` and the Docker `setup` service load it into the shared, read-only `ref.medicines` table the first time, and again only when the file changes (about 20 seconds); otherwise they report it as up to date. Set `SKIP_REFERENCE_DATA=true` to skip it, for example on a throwaway database.

Source: the public "A-Z Medicine Dataset of India", compiled from online pharmacy listings. The client chose this source knowing it is not formally licensed for commercial reuse; replace the file with a licensed list if that changes. Listed MRPs are dated and are never used as selling prices.

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
| `DATA_ENCRYPTION_KEY` | Follow the steps below; nothing becomes unreadable |
| Database TLS certificate | See [Database TLS](#database-tls) |

#### The data encryption key

`DATA_ENCRYPTION_KEY` encrypts lab documents, clinical notes and WhatsApp tokens inside the database (AES-256-GCM). The web server and the worker refuse to start in production without it. Keep a copy in a password manager or secrets vault: **without it those records cannot be read, and backups do not contain it.**

Each encrypted value records which key encrypted it. To change the key, for example yearly or after anyone with access leaves:

1. `openssl rand -base64 32` for the new key.
2. In `.env`: the new key as `DATA_ENCRYPTION_KEY`, and the old one in `DATA_ENCRYPTION_KEYS_OLD`. Then `docker compose up -d`. Old values still read, and new ones use the new key.
3. `npm run ops:rotate-key` re-encrypts every value under the new key. It runs in batches and can be stopped and run again.
4. `npm run ops:rotate-key -- --check` must report 0 everywhere.
5. Remove `DATA_ENCRYPTION_KEYS_OLD` and `docker compose up -d`. Keep the old key with the backups made before the change: restoring one of those needs it.

The same command encrypts rows written before a column was encrypted, after an upgrade that adds one.

## Backups

`scripts/ops/backup.sh` streams a compressed `pg_dump` straight into GnuPG. A backup only ever reaches disk encrypted, as `medflow-<time>.dump.gpg` (OpenPGP, AES-256), with a `.sha256` checksum beside it. The same stream is checked to be a readable dump as it is written. Run it next to `docker-compose.yml`.

It encrypts to a **public key**, so the server can make backups but cannot read them. The script refuses to run without the key, refuses a file that contains a private key, and never falls back to writing a plain dump.

### The backup key, once

Make the key pair on a trusted computer, **not the server**:

```bash
gpg --quick-gen-key "NuvaLyf backups <backups@your-clinic.in>" rsa4096 encrypt never
gpg --armor --export backups@your-clinic.in > backup-public.asc
gpg --armor --export-secret-keys backups@your-clinic.in > backup-private.asc
```

- Copy only `backup-public.asc` to the server (for example `/etc/nuvalyf/backup-public.asc`).
- Keep `backup-private.asc` and its passphrase in two separate safe places (a password manager and a sealed envelope, for example), held by two people. **Without it no backup can be restored.**
- Delete `backup-private.asc` from the computer once it is stored.

**Schedule:** nightly, plus before every upgrade. Example crontab:

```
30 1 * * *  cd /srv/medflow && BACKUP_PUBLIC_KEY=/etc/nuvalyf/backup-public.asc scripts/ops/backup.sh /srv/backups >> /var/log/medflow-backup.log 2>&1
```

Lab documents are stored in the database, so backups grow with them. Watch backup size and disk space.

**Retention:** keep 30 daily and 12 monthly copies, and copy every backup **off the server** (object storage with versioning or a second site, in India). Copy the `.sha256` with it. Clinical records generally have multi-year legal retention; follow local regulation for how long monthly copies are kept. Remove old local files with, for example, `find /srv/backups -name 'medflow-*.dump.gpg*' -mtime +30 -delete`.

`DATA_ENCRYPTION_KEY` and `.env` are not in the dump. Store them in a password manager or secrets vault.

### Restoring

Never restore over the live database. Restore into a new one, verify, then switch. The backup private key must be imported (`gpg --import backup-private.asc`) by whoever restores, for the duration of the restore only. The checksum is checked first, and decryption fails if the file was changed at all.

```bash
scripts/ops/restore.sh /srv/backups/medflow-20261016T013000Z.dump.gpg medflow_restored
npm run ops:verify-restore -- medflow_restored     # compares with the live DB
# then set POSTGRES_DB / the connection strings to medflow_restored and
docker compose up -d
```

`ops:verify-restore` runs from the checkout on the host (Node 22 and `npm ci` needed once). It reads `DATABASE_OWNER_URL` and `DATABASE_URL` from `.env`, pointed at `127.0.0.1:${DB_PORT}`. It checks row counts for every table, the migration history, that row-level security is on for every clinic table, that every guard trigger is present, that the audit trail is still append-only, and that the app role sees no patient rows without a clinic context.

### Restore drill

Run the drill **every quarter** and after any infrastructure change: restore last night's backup into a scratch database, run `ops:verify-restore`, record the result, drop the scratch database. The drill also proves the private key is still where you think it is.

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

CERT-In's directions (28 April 2022) require logs of every system to be kept for **180 days, in India**, and handed over with any incident report. Report a cyber incident to CERT-In (incident@cert-in.org.in) **within 6 hours** of noticing it. Reportedly from May 2027, the DPDP Rules ask for one year of logs. Keep a year if you can.

| Log | Where | Kept |
| --- | --- | --- |
| **Audit trail**: every sign-in, failed sign-in, refusal, record opened, change and export | The database (`audit_events`), which cannot be altered, even by the app | For as long as the records: never deleted, and in every backup |
| **Application and database logs**: errors, start-ups, every database connection with time, user, database and client address | Container output | Use `docker-compose.logging.yml` (below) |
| **Web access logs**: every request with its status | The reverse proxy (Traefik, Caddy, nginx) | Configure on the proxy (below) |

**Container logs by time.** `docker-compose.yml` caps each service at about 200 MB, which cannot promise 180 days. In production, add the journald override, so the host's journal keeps them by age:

```bash
docker compose -f docker-compose.yml -f docker-compose.logging.yml up -d
```

Then in `/etc/systemd/journald.conf` (or a drop-in in `/etc/systemd/journald.conf.d/`):

```
[Journal]
Storage=persistent
MaxRetentionSec=200day
SystemMaxUse=20G
```

Run `systemctl restart systemd-journald`. Then `scripts/ops/check-log-retention.sh` prints the setting and how far back each service's logs go, and fails if it is under 180 days. Keep its output with the audit file. Read logs with `journalctl -t nuvalyf-web --since "2026-11-01"`.

**Access logs on the proxy.** Traefik (Dokploy): enable the access log to a file and rotate it with logrotate (`rotate 200`, `daily`). Caddy: `log { output file /var/log/caddy/access.log { roll_keep_for 4800h } }`. nginx: logrotate with `rotate 200` and `daily`.

Server logs do not contain patient data: database errors are logged without their parameters, and URLs carry record ids, not names. The audit trail is the authoritative record of who did what.

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
