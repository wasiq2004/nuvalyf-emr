<p align="center"><img src="public/brand/nuvalyf-logo.png" alt="NuvaLyf" width="320"></p>

# NuvaLyf

NuvaLyf is a multi-clinic electronic medical record and practice management system. It has three layers:

- **Super Admin (operations console, `/platform`)** onboards clinics, assigns plans and modules, suspends or reactivates clinics and rescues a locked-out clinic admin. It never sees patient data.
- **Clinic Admin** runs one clinic: staff and roles, services and schedules, the medicine and lab catalogue, billing, messaging, imports and reports.
- **Clinic staff** each get only what their job needs: Receptionist, Nurse, Doctor, Lab Technician, Pharmacist, Analyst and Auditor.

A clinic day runs end to end: registration and booking, walk-ins and the queue, triage and vitals, consultation with diagnoses, prescriptions and lab orders, signing, billing and payments, pharmacy dispensing and stock, WhatsApp reminders and consent-gated broadcasts, reports, a compliance audit panel, and de-identified analytics.

The codebase keeps its original technical name, `medflow` (package, database roles such as `medflow_app`, cookies, Docker project), so existing installs and sessions are unaffected. Brand assets are in `public/brand/`; the name and tagline live in `lib/brand.ts`.

Built with Next.js 16 (App Router, Server Actions), React 19, PostgreSQL 16 with Drizzle ORM, Auth.js v5 and Tailwind CSS v4. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits together and [docs/SECURITY.md](docs/SECURITY.md) for the security model.

---

## Quick start (Docker)

```bash
cp .env.example .env
# Edit .env: database passwords, AUTH_SECRET, PLATFORM_AUTH_SECRET,
# DATA_ENCRYPTION_KEY and the first Super Admin's email and password.
# Generate each secret with: openssl rand -base64 32
docker compose up --build -d
```

Open <http://localhost:3000/platform/login> and sign in as the Super Admin. Onboard a clinic from **Clinics → New clinic**; the clinic admin's temporary password is shown once. Clinic staff sign in at <http://localhost:3000/login> with the clinic code, their email and password.

`docker compose up` starts four services:

| Service | What it does |
| --- | --- |
| `db` | PostgreSQL 16, bound to 127.0.0.1 only |
| `setup` | One-shot: creates the database roles, applies migrations and security policies, creates the first Super Admin if missing. Never deletes data |
| `web` | The application |
| `worker` | Appointment reminders and WhatsApp broadcasts (safe to run more than one; only one works at a time) |

There are no demo accounts. Every account is created by an administrator and starts with a temporary password that must be changed at first sign-in.

---

## Local development

Requires Node.js 22 and PostgreSQL 14+ (or Docker for the database).

```bash
npm install
cp .env.example .env               # fill in the connection strings and secrets
npm run db:migrate                 # create roles, apply migrations and policies
npm run db:create-platform-admin   # first Super Admin from PLATFORM_ADMIN_*
npm run dev
```

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run worker` | Messaging worker (reminders, broadcasts) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | Unit tests, including the generated permission matrix |
| `npm run test:integration` | Integration tests against a real Postgres (creates its own test database) |
| `npm run test:e2e` | Playwright, every role's flow against a running server (`E2E_BASE_URL`) |
| `npm run db:generate` | Generate a migration after a schema change |
| `npm run db:migrate` | Roles + migrations + security policies. Idempotent; run on every deploy |
| `npm run db:bootstrap` | `db:migrate` + first Super Admin (what the Docker `setup` service runs) |
| `npm run db:create-platform-admin -- <email> <password>` | Create a Super Admin (password 12+ characters) |
| `npm run db:reset` | **Deletes all data.** Refused when `NODE_ENV=production` unless `ALLOW_DESTRUCTIVE_RESET=true` |
| `npm run load:clinic-day -- [patients] [concurrency]` | Load test in a throwaway database |
| `npm run ops:verify-restore -- <database>` | Check a restored backup (see [docs/OPERATIONS.md](docs/OPERATIONS.md)) |

---

## Configuration

Every variable is documented in [.env.example](.env.example). The important ones:

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_OWNER_URL` | migrations | Schema owner. Used only by `db:*` scripts, never by the running app |
| `DATABASE_URL` | yes | `medflow_app` role: clinic and compliance panels, row-level security enforced |
| `PLATFORM_DATABASE_URL` | yes | `medflow_platform` role: operations console, no access to clinical tables |
| `PROVISIONER_DATABASE_URL` | no | `medflow_provisioner` role: clinic onboarding and admin rescue. Remove to switch both off |
| `AUTH_SECRET` / `PLATFORM_AUTH_SECRET` | yes | Separate signing secrets for clinic and console sessions |
| `AUTH_URL` | prod | Public URL. `https://` enables `__Secure-` cookies and upgrade-insecure-requests |
| `DATA_ENCRYPTION_KEY` | WhatsApp | 32 bytes, base64. Encrypts stored WhatsApp tokens |
| `WHATSAPP_DRIVER` | no | `cloud` (Meta Cloud API) or `log` (record only) |
| `TRUST_PROXY_HOPS` | no | Reverse proxies in front of the app. Default 1 |

---

## Documentation

| Document | For |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Developers: layers, data model, request flow |
| [docs/SECURITY.md](docs/SECURITY.md) | Security model, guarantees and review findings |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Deploying, backups, monitoring, load-test results |
| [docs/user-guide/](docs/user-guide/README.md) | Staff guides, one per role |
| [docs/UAT_CHECKLIST.md](docs/UAT_CHECKLIST.md) | Acceptance testing with a pilot clinic |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) / [docs/PROGRESS.md](docs/PROGRESS.md) | The plan and what was built |

The original single-clinic v1 (patient portal, doctor portal) is parked in `legacy/v1` and is not built or served. The patient portal will return as a per-clinic module when requested.
