# NuvaLyf architecture

A single Next.js 16 application (App Router) backed by PostgreSQL 16, plus a small background worker. There is no separate API service: pages are React Server Components that read through the service layer, and every mutation is a Server Action.

## Three layers, three panels

| Panel | Routes | Who | Database role |
| --- | --- | --- | --- |
| Operations console | `/platform/*` | Super Admins and operators (`platform.operators`) | `medflow_platform`: clinics, plans, usage counts. No access to any clinical table |
| Clinic panel | `/today`, `/patients`, `/queue`, `/encounters`, `/billing`, `/pharmacy`, `/lab`, `/settings/*`, `/reports`, `/analytics`, `/broadcasts` | Clinic staff (`app.users`), permissions from their roles | `medflow_app`: row-level security, one clinic per transaction |
| Compliance panel | `/audit/*` | Auditor and Clinic Admin (`audit:read`) | `medflow_app`, audit tables only (ESLint stops it importing clinical code) |

Clinic onboarding and admin rescue use a fourth role, `medflow_provisioner`, which can create a clinic and its first admin but cannot read clinical data. Remove `PROVISIONER_DATABASE_URL` and both features switch off.

The two sign-ins are separate Auth.js instances with separate cookies and secrets (`AUTH_SECRET`, `PLATFORM_AUTH_SECRET`). A console session cannot open a clinic page and a clinic session cannot open the console.

## Request flow

```
Browser
  │ page request (GET)                     │ Server Action (POST + Next-Action header)
  ▼                                        ▼
proxy.ts                                   (passed through: actions authorize themselves)
  │ CSP nonce on every page
  │ no session cookie -> matching sign-in
  ▼                                        ▼
layout / page.tsx                          features/<domain>/<domain>.actions.ts
  requireClinic({ permission, module })      clinicAction({ name, permission, module, schema })
  (re-validates session against the DB:      1. live session, re-checked against the DB
   suspension and deactivation are instant)  2. permission + module, refusals audited
  ▼                                          3. zod input, safe error messages
features/<domain>/*.service.ts             ▼
  ("server-only", Drizzle, takes a Tx)  <──  withClinic({ clinicId, userId }, tx => ...)
  ▼
PostgreSQL
  set_config('app.clinic_id'), set_config('app.user_id') for the transaction
  row-level security on every app.* table, guard triggers, audit triggers
```

Authorization is enforced in independent places so no single layer is load-bearing:

1. **`proxy.ts`** only redirects people without a session cookie and sets the per-request CSP nonce. Next.js documents that Proxy must not be the sole check.
2. **Page guards** (`requireClinic`, `requireOperator`) re-read the user, clinic status, roles and plan modules from the database on every request.
3. **Action wrappers** (`clinicAction`, `platformAction` in `lib/auth/actions.ts`) repeat that check for every mutation. A unit test discovers every `*.actions.ts` file and checks each action against the permission matrix; an action without an entry fails the build.
4. **The database** isolates clinics with row-level security keyed on `app.clinic_id`, and composite `(clinic_id, id)` foreign keys make cross-clinic references impossible even for buggy code.

## Code layout

```
app/                  routes only: pages, layouts, PDF route handlers
  (auth)/             clinic sign-in, forced password change
  (clinic)/           the clinic panel
  (compliance)/       the audit panel
  platform/           the operations console
  api/health          liveness + worker heartbeat
features/<domain>/    business logic
  *.service.ts        data access, takes a Tx; no session handling
  *.actions.ts        Server Actions built with clinicAction/platformAction
  *-rules.ts          pure rules (unit tested): pricing, stock, vitals, suppression...
components/app/       the shared design kit (PageShell, PageHeader, Panel, DataTable,
                      StatusBadge, form kit, dialogs, charts). Every screen uses it
components/<domain>/  domain components
lib/
  access/             permissions, system roles, plan modules
  auth/               the two Auth.js instances, session guards, action wrappers
  db/                 pools per role, withClinic/withPlatform/withProvisioner, schema
  pdf/                prescription, invoice and receipt PDFs (shared letterhead)
  messaging/          WhatsApp Cloud API client
  crypto.ts, csp.ts, idempotency.ts, money.ts, rate-limit.ts, request.ts, time.ts
db/
  migrations/         drizzle-kit migrations (CI fails if the schema drifts)
  sql/security.sql    roles' grants, RLS policies, guard and audit triggers (re-applied on every migrate)
  sql/views.sql       owner-defined views the console reads (usage counts, no clinical rows)
worker/index.ts       reminders and broadcasts loop
scripts/              db tasks, load test, backup/restore drill
tests/                unit, integration (real Postgres), e2e (Playwright)
legacy/v1/            the parked single-clinic v1, not built
```

## Data model

Three schemas:

- **`platform`**: operators, plans, plan modules, clinics, platform audit.
- **`app`**: everything belonging to a clinic. Every table has `clinic_id`, RLS enabled, and composite foreign keys.
  - Identity and access: users, roles, role permissions, user roles, clinic settings.
  - Front desk: patients, services, doctor schedules and leave days, appointments, visits and the queue.
  - Clinical: encounters, vitals, allergies, diagnoses, prescriptions and items, lab orders, amendments, private notes, and the medicine and lab catalogue.
  - Billing: invoices, invoice items, payments.
  - Pharmacy: stock batches, stock movements, sales, prescription queries, suppliers, purchase orders.
  - Messaging: consent events, WhatsApp config, templates, broadcasts, message log, import jobs.
  - Analytics: cohorts, cohort runs, exports.
  - Audit: `audit_events`, append-only.
- **`sys`**: rate limits, idempotency keys, worker heartbeats.

Integrity rules live in the database, so they hold whatever the application does:

- **Finalised records are immutable.** After a consultation is signed, notes, vitals, diagnoses and prescriptions reject changes (custom SQLSTATE `MFL01`). Corrections are amendments.
- **Append-only tables** reject UPDATE and DELETE: both audit trails, allergy history, encounter amendments, payments, stock movements, pharmacy sales and their items, consent events, cohort runs and analytics exports.
- **Stock is a ledger.** Each movement row updates its batch through a trigger; a CHECK keeps quantities at or above zero, so concurrent dispensing cannot oversell.
- **Money** is stored as integer minor units (paise).
- **Idempotency.** Payments, sales and imports carry a key, so a double-click or retry never charges twice.

## Background worker

`worker/index.ts` runs one pass a minute. For every active clinic with the WhatsApp module it queues appointment reminders that are due and sends what is waiting in the outbox (`app.message_log`), reminders and broadcasts alike. Temporary failures are retried on later passes up to a fixed number of attempts; permanent ones (such as an invalid number) are marked failed straight away. One clinic's problem, such as a bad token, never stops the others. A Postgres advisory lock means extra replicas wait rather than double-send. Each pass writes a heartbeat to `sys.heartbeats`, which `/api/health` reports.

## Testing

| Layer | Proves |
| --- | --- |
| Unit (Vitest) | Pure rules, plus the generated permission matrix: every action × every role |
| Integration (Vitest + Postgres) | Clinic isolation, immutability, append-only audit, stock ledger, idempotency, all-or-nothing imports, de-identification |
| End-to-end (Playwright) | Each role's flow in a real browser against a production build, CSP enforced |
| Load (`npm run load:clinic-day`) | A busy clinic day at realistic concurrency; see [OPERATIONS.md](OPERATIONS.md#load-test) |
