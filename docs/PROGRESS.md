# NuvaLyf (MedFlow v2): Build Progress

Tracks work against [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). Nothing is committed to git until every phase is done (client instruction), so this file is the record of progress.

**Local dev database:** `docker compose -p medflow-dev up -d db` (port 5433, isolated from the old v1 container on 5432). Then `npm run db:migrate`.

---

## Phase 0: Foundations ✅

- [x] v1 app moved to `legacy/v1/` (excluded from build/lint/tests; reference for the hidden patient portal)
- [x] v2 schema in `lib/db/schema/` across Postgres schemas `platform`, `app`, `sys`
- [x] Versioned migrations (`db/migrations`, drizzle-kit) + idempotent `db/sql/security.sql`
- [x] Four DB roles: owner (migrations), `medflow_app`, `medflow_platform`, `medflow_provisioner`; login roles created from their connection strings, never superuser/BYPASSRLS
- [x] RLS on every `app` table (security script refuses an `app` table without `clinic_id`)
- [x] Composite `(clinic_id, id)` foreign keys so records cannot reference another clinic
- [x] `withClinic()` / `withPlatform()` / `withProvisioner()` access helpers; app refuses to start on an RLS-bypassing role
- [x] Append-only audit (`app.audit_events`, `platform.audit_events`): trigger blocks UPDATE/DELETE/TRUNCATE even for the owner
- [x] Integration test harness (throwaway `medflow_test` DB) + 14 security tests
- [x] Docker: `tools` image runs roles → migrations → security → first Super Admin
- [x] CI: Postgres service, integration tests, migrations-in-sync check

Deferred (not needed yet): Playwright → Phase 3 (first full UI flow); pg-boss worker → Phase 8 (reminders/broadcasts).

## Phase 1: Platform layer ✅

- [x] Access catalogue: `lib/access/` (permissions with module gating + adjustable flag, 6 modules incl. hidden `patient_portal`, 8 default roles)
- [x] Two Auth.js instances: clinic (`medflow.clinic`, 8 h) and console (`medflow.platform`, 1 h hard limit, own secret/base path)
- [x] argon2id passwords, generated one-time passwords shown once, forced change on first sign-in, session-version revocation
- [x] Postgres-backed rate limiting (per account + per IP), timing-safe login, failed/refused logins audited
- [x] Live session re-validation every request: clinic suspension, account status, session version, roles, plan modules
- [x] `clinicAction()` / `platformAction()` wrappers: session + permission + module + zod + audited denials + safe errors
- [x] Design kit `components/app/` (page shell/header, panel, stat card, table, badges, buttons, form kit, dialogs, one-time secret, app shell) with per-panel accents via `data-accent`
- [x] Operations console: estate, clinics list, onboarding (provisioner, all-or-nothing), clinic detail (plan, suspend w/ reason, restore, contact, admin rescue), plans editor (dependency rules), operators (Platform Admin only), own password
- [x] Clinic: sign-in with clinic code, forced password change, `/today`, 403 page (`forbidden()`)
- [x] Patient portal hidden: not offerable on plans, ignored even if forced into DB, `/patient` routes do not exist
- [x] Tests: 34 integration (DB), 36-check HTTP end-to-end, real-browser walkthrough with screenshots (light/dark/mobile)

Bugs found by end-to-end testing and fixed:
- Auth.js treats cookies prefixed with the session cookie name as token chunks; helper cookies renamed (`medflow_clinic_csrf`, …)
- Form fields lost vertical spacing (`display: contents` fieldset); fixed in the shared `ActionForm`

Notes for later phases:
- Role homes point at `/today` until `/pharmacy` (P6), `/analytics` (P9), `/audit` (P7) exist: update `lib/access/roles.ts` (set `homeModule` where the page needs a module). `/lab` done in P4
- HTTP e2e + screenshot scripts live outside the repo for now; port to Playwright tests in Phase 3
- ~~README still describes v1 setup~~: rewritten in Phase 10

## Phase 2: Clinic Admin & staff ✅

- [x] Schema: `services`, `schedules` (several windows per weekday for split shifts), `doctor_services`
- [x] `/settings/clinic`: identity, letterhead/footer (printed later), timezone, slot length, currency
- [x] `/settings/users`: staff list with stats, add staff (one-time password shown once), detail page (profile, roles, doctor registration no./council), disable/enable (ends sessions), re-issue password (audited)
- [x] Safety rules: no self-disable / self-demotion / self-reissue; the clinic always keeps an active Clinic Admin; unique email per clinic (case-insensitive)
- [x] `/settings/roles`: per-role permission view; adjustable grants toggle live; safety rules locked; module-gated grants flagged; Auditor/Analyst cannot be widened; reset to defaults
- [x] `/settings/services` and `/settings/schedules/[doctor]` (week editor, copy Mon–Fri, overlap validation, services offered)
- [x] `/account` for every staff member
- [x] Permission matrix test: every exported action must be wrapped; every clinic action × every role checked (refused + audited, or admitted); Platform-Admin-only actions refuse operators
- [x] Tests: 110 unit, 52 integration, browser walkthrough (onboard → admin set-up → receptionist gets 403, audited critical)

Design decisions:
- Removed the "doctors can admit emergencies" clinic setting: `emergency:admit` on the Doctor role is the single control

## Phase 3: Front desk ✅

- [x] Schema: `patients` (per-clinic MRN via atomic counter, DOB or stated age + stated-on date, placeholder flag), `duplicate_overrides`, `appointments`, `visits` (the queue), `tasks`, `clinic_counters`
- [x] DB-level double-booking prevention: exclusion constraint on (clinic, doctor, time range) for active appointments (`btree_gist`); trigram index for fuzzy names (`pg_trgm`)
- [x] Search before create, enforced: signed, expiring, user/clinic-bound token over the exact searched details; likely duplicates need a written reason (stored, shown on the record, audited as a warning)
- [x] Duplicate scoring: similar name + (same mobile | same DOB | similar age); a shared family mobile alone never counts
- [x] Emergency button in the header (permission-gated): one required label, front of the queue (sorted by flag), companion phone shown, URGENT task that closes only when the record is completed
- [x] Booking: slots from schedules × service duration on the clinic grid, split shifts, server re-derives availability, races resolved by the DB (exclusion violation or deadlock → "just taken")
- [x] Appointments day view (check in, cancel with reason, no-show after start), booking screen (patient lookup, doctor → services, live slots)
- [x] Queue board (auto-refresh, wait clocks, routine reordering, mark left), patient search/detail (visits visible, no clinical content), role-adaptive `/today`
- [x] Audit: patient views (`PATIENT_VIEWED` with patient id), searches, registrations, overrides, bookings, check-ins, emergencies
- [x] Tests: 230 unit (incl. permission matrix over 30+ actions), 68 integration, Playwright e2e in repo (`npm run test:e2e`, 6 scenarios, stable)

Bugs found and fixed during Phase 3:
- ICU lists `Asia/Calcutta`, not `Asia/Kolkata`: timezone dropdowns silently fell back to the first zone (would have changed a clinic's timezone on save). Shared `timezoneOptions()` always includes the current zone
- Concurrent conflicting inserts under an exclusion constraint can deadlock (40P01); mapped to the same "slot taken" message

Backlog (not in the diagrams' must-haves, revisit in Phase 10), both done in Phase 10:
- ~~Doctor leave days / schedule exceptions~~
- ~~Rescheduling an appointment in one step (today: cancel + rebook)~~

## Phase 4: Clinical ✅

- [x] Schema: `encounters` (one per visit), `vitals` (server-computed flags), `allergies` + `allergy_history`, `diagnoses`, `prescriptions` + `prescription_items` (catalogue snapshot per item), `encounter_amendments`, `private_notes`, `lab_orders`; patients gain "no known allergies" (checked vs never asked)
- [x] Clinic-owned catalogues (D6): `drugs`, `allergy_classes`, `drug_allergy_classes`, `drug_interactions` (by generic name), `prescribing_presets`, `diagnosis_codes` (WHO ICD-10 starter subset + custom), `vital_ranges` (age-banded), `lab_tests`
- [x] Starter templates in `lib/catalog/starter.ts` (49 medicines, 32 interaction rules, 10 allergy classes, 56 ICD-10 codes, age-banded vital ranges, 23 lab tests, presets) copied into each clinic at onboarding; "new starter entries available" import adds only missing keys and never revives deactivated entries
- [x] `/settings/catalog`: tabs for medicines (Pharmacist + Admin), interactions, allergy classes, presets, diagnosis codes (favourites), vital ranges, lab tests; add / edit / deactivate everywhere, never delete
- [x] Nurse: Today = triage list; start triage → vitals (flagged against the clinic's ranges for the patient's age) → allergies (add-only, reasoned corrections, "no known allergies") → hand over as READY
- [x] Doctor: Today = own queue (emergencies, then ready, then waiting), wait times, "Call next patient", with-me-now, unread lab results; call stops the wait clock; another doctor's patient cannot be taken
- [x] Consultation screen: sticky allergy banner (recorded / none known / not asked), registration-number gate shown on open, notes, ICD-10 search with favourites and custom codes, prescription builder with live allergy + interaction + duplicate check (re-run on the server; allergy/major/contraindicated need a written reason, audited as a warning), lab orders, private note (author only), previous consultations
- [x] Sign & finalise: needs a registration number; signs the prescription with a full snapshot (clinic letterhead, prescriber, patient, diagnoses, items); completes the visit and appointment; amendments afterwards
- [x] Immutability in the database (`db/sql/security.sql`, SQLSTATE `MFL01`): finalised consultations and their vitals/diagnoses, signed prescriptions and their items, resulted lab orders; only the pharmacy's dispense status moves. Holds for the app role and the owner role. Allergies cannot be deleted; allergy history and amendments are append-only; private notes have a restrictive author-only RLS policy
- [x] Prescription PDF (`/encounters/:id/prescription`, pdf-lib) rendered only from the signed snapshot; every print audited
- [x] Lab module: doctor orders, Lab Technician worklist at `/lab` (now the role's home when the clinic has the module), results final once entered, back to the ordering doctor until marked read
- [x] Queue screen: Call (doctor) / Triage (nurse) / Open (anyone with clinical read) per row; patient record shows allergies and consultation history to clinical roles only
- [x] Audit: consultation views, prescription prints, vitals, allergy changes, diagnoses, prescribing (with overrides), signing, amendments, lab events
- [x] Tests: 611 unit + integration (18 clinical integration tests incl. direct-SQL tamper attempts as app and owner role), Playwright e2e now 10 scenarios (nurse → doctor → lab → admin), stable

Bugs found and fixed during Phase 4:
- The consultation guard on `prescriptions` would also have blocked the pharmacy from updating dispense status after signing; narrowed to INSERT/DELETE (updates governed by the signed-prescription guard)
- Server pages imported `inputClass` from the `"use client"` form kit and silently got no styles (search boxes on Patients/Appointments since Phase 3). Moved to `components/app/styles.ts`; a unit test now fails if a server file imports a non-component value from a client module
- Mobile overflow on the consultation screen (grid columns need `min-w-0`); BP tile clipped its unit

Notes:
- New kit pieces: `ActionButton` (one-click action, optional navigation), `TabNav` (URL-driven tabs), `components/clinical/*` (allergy banner/list/dialogs, vitals grid, clinical day views, queue buttons)
- Drug quantity is optional on prescriptions today; the pharmacy (Phase 6) will compute or require it at dispensing

## Phase 5: Billing ✅

- [x] Schema: `invoices` (per-clinic `INV-000001` numbers, one live invoice per visit), `invoice_items` (service / lab / medicine / other, `amount = unit price × qty` enforced), `payments` (payments and refunds, append-only, idempotency key unique per clinic)
- [x] Exact money: amounts are NUMERIC strings, arithmetic in integer minor units (`toMinor` / `fromMinor`); no floats anywhere
- [x] Bill a visit: draft pre-filled with the visit's service and the lab tests ordered in its consultation; or a blank invoice from the patient record
- [x] Drafts: add/remove lines (service picker or free text), discount with a required reason (cannot exceed the bill), issue, discard
- [x] Payments (cash / UPI / card / other + reference): the invoice row is locked, then the idempotency key is checked, so a double-click, a retry or two tabs record one payment; never more than the balance; taking money issues a draft
- [x] Refunds (reason required, up to what was paid) and void (only an issued invoice with nothing paid; reason kept)
- [x] Database guards: issued invoice amounts and lines are fixed, void is final, issued invoices cannot be deleted, payments cannot be edited or deleted
- [x] `/billing`: collected today (net, per method), outstanding, "to bill" (finished visits without an invoice), filters (outstanding / drafts / today / all); invoice page; invoice / receipt PDF on the letterhead
- [x] Front-desk Today shows "To bill"; patient record shows invoices and the outstanding balance; Billing in the nav for `billing:read`
- [x] Audit: invoice created / viewed / printed / issued / discarded / voided, lines, discounts (warning), payments, refunds (warning)
- [x] Tests: 703 unit + integration (9 billing integration tests incl. the concurrent double-submit producing exactly one payment), e2e 11 scenarios (double-click on "Record payment" records one payment)

Notes:
- `lib/pdf/letter.ts` is the shared letterhead/A4 layout for every PDF (prescription, invoice; pharmacy receipts next)
- The PDF fonts cannot draw ₹, so PDFs print "Rs." (screens show ₹)

## Phase 6: Pharmacy ✅

- [x] Schema: `stock_batches` (batch no. + expiry per medicine), `stock_movements` (the ledger), `pharmacy_sales` + `pharmacy_sale_items` (batch and expiry on every line), `prescription_queries`, `suppliers`, `purchase_orders` + items, `idempotency_keys`; medicines gain a reorder level
- [x] Stock lives on the clinic's own medicine list (D6): no separate stock-item catalogue to keep in sync
- [x] Ledger in the database: a movement trigger applies every change to its batch; quantities cannot be edited directly (even by the owner role), can never go below zero (CHECK), batches are never deleted; ledger and sales are append-only
- [x] Generic idempotency (`lib/idempotency.ts`): key claimed in the same transaction as the work, result stored; a concurrent duplicate waits and gets the first result; same key with different input is refused
- [x] Prescription queue (signed, module-gated, last 30 days): pharmacist sees name, age, sex, allergies and the source visit (doctor, date) only
- [x] Fill a prescription: batch per line (earliest expiry first), quantity from the course (dose × frequency × days for countable forms), substitution only with the same generic, expired batches refused, partial fills tracked, "close without dispensing" with a reason; payment + stock movement in one idempotent transaction
- [x] Clarifications: "Ask doctor" per line → prescriber's Today ("Pharmacy questions") and the consultation page → answer back to the pharmacy; the prescription is never edited
- [x] Counter sales: search stock, basket, payment; idempotent; receipt page and PDF
- [x] Stock screens: on hand / reorder level / next expiry with filters (low/out, expiring, slow moving); per-medicine batches, ledger, add stock (opening / delivery / return), write-offs and count corrections with a note, reorder level
- [x] Alerts: out (only for medicines the pharmacy stocks), low (at or below reorder level), expiring (90 days), expired stock, slow moving (no outflow for 90 days)
- [x] Purchase orders: suppliers, draft → submit → approve/reject (`purchase:approve`, never by the person who raised it) → receive (batch/expiry per line, idempotent, into the ledger); cancel
- [x] Pharmacist lands on `/pharmacy` (when the clinic has the module); nav: Pharmacy, Stock, Purchases; the sidebar now highlights only the most specific match
- [x] Tests: 868 unit + integration (pharmacy integration: ledger guards, oversell race, idempotent sale/receipt double-submits, substitution rules, queries, PO approval separation), e2e 12 scenarios incl. pharmacist (price → stock → fill with double-click = one sale → counter sale → ledger total)

Bugs found and fixed during Phase 6:
- Never-stocked starter medicines showed as "out"/"low" (a fresh pharmacy reported 49 alerts); alerts now apply only to medicines the pharmacy has stocked or set a reorder level for

## Phase 7: Compliance & reports ✅

- [x] Compliance panel at `/audit` with its own layout, accent (`compliance`) and navigation; the Auditor lands there; people who also work in the clinic get a "Clinic panel" link back
- [x] Audit trail: filter by date range, person, patient record number, event, outcome, severity; filters live in the URL; cursor pagination; CSV export (formula-injection safe, max 10,000 rows)
- [x] "Who opened this record?": by record number and period, per person (roles, times, first/last, what was opened) and every access with the IP
- [x] Summary: totals (events, records opened, refused, critical, failed sign-ins), activity per day chart, most active people, most frequent events, every refused attempt
- [x] Clinical details withheld: events about prescriptions, diagnoses, vitals, allergies, lab, consultations keep who/what/when/whose, never the content (drug, code, reason)
- [x] Reading the log is logged (`AUDIT_VIEWED`, `AUDIT_RECORD_ACCESS_VIEWED`, `AUDIT_SUMMARY_VIEWED`, `AUDIT_EXPORTED` as a warning)
- [x] ESLint `no-restricted-imports`: `app/(compliance)` and `app/platform` cannot import any component or service that renders patient or clinical data (verified to fire)
- [x] Clinic `/reports` (Reports module): collections per day (clinic billing net of refunds + pharmacy, stacked chart), by payment method, outstanding by age (0-30 / 31-60 / 61-90 / 90+), visits per day, by doctor (seen, emergencies, average wait), new patients, audit summary for admins
- [x] Design kit: `BarChartPanel` (recharts, coloured from the panel accent, works in dark mode)
- [x] Tests: 878 unit + integration (record access, redaction, filters + cursor, summary, report sums incl. refunds and pharmacy), e2e 14 scenarios: the Auditor finds who opened P-000001 and gets 403 on patients, queue, billing, pharmacy, reports, a consultation and its prescription PDF

Bugs found and fixed during Phase 7:
- Grouping by a time-zone expression failed (each copy gets its own parameter); grouped by position instead
- Raw SQL rejected `Date` parameters through the driver; report queries pass ISO strings with an explicit cast

## Phase 8: Messaging & import ✅

- [x] Schema: `consent_events` (append-only history, strict order by an identity column), `whatsapp_config` (one per clinic), `message_templates`, `broadcasts`, `message_log` (the outbox and the record of every message), `import_jobs`
- [x] Consent per patient and type (WhatsApp reminders / WhatsApp clinic updates): patient record panel with one-click agree/withdraw (needs a mobile), history, audited (`CONSENT_GRANTED` / `CONSENT_WITHDRAWN`, visible in the compliance panel without content)
- [x] `/settings/messaging`: Cloud API connection (phone number ID, WABA ID, access token **encrypted at rest**, AES-256-GCM with `DATA_ENCRYPTION_KEY`; blank keeps the stored token), reminders on/off, hours before, reminder template; "check connection"; approved templates; 30-day sent/queued/failed counts; test-mode banner
- [x] Broadcasts (`/broadcasts`, `broadcast:send`): template + audience (everyone / seen in the last N days), live count of who will receive it and who is left out (no consent / no mobile) before sending, explicit confirmation, idempotent queueing, progress per broadcast
- [x] Reminders: every booked appointment inside the window, for patients who agreed, once per appointment (unique index)
- [x] Worker (`npm run worker`, Docker target `worker`, compose service): one pass a minute per active clinic with the module, RLS-scoped as the app role; Postgres advisory lock so only one replica works; `--once` for cron/debugging. Outbox in Postgres instead of pg-boss (same guarantees, no extra dependency or schema)
- [x] Consent re-checked for every message at send time; cancelled/moved appointments skipped; transient failures retried (3 attempts), 4xx failures final
- [x] WhatsApp drivers: `cloud` (graph.facebook.com) and `log` (records without sending: development, tests, clinics awaiting Meta verification)
- [x] `/settings/import` (`import:run`): template CSV, column help, check → full report by line → import (only offered when clean); server re-checks and commits all rows in one transaction or none; idempotent; likely duplicates of existing patients refused (same rule as the front desk); stated ages dated with the import date; consents recorded with source "import"; history of imports and refused attempts
- [x] CSV parser: quotes, embedded commas/newlines, CRLF, BOM; header aliases (e.g. Gender, DOB, Surname); dd/mm/yyyy dates; 2,000 rows / 2 MB per file (Server Action body limit raised to 3 MB)
- [x] Tests: 962 unit + integration (a broadcast never reaches a patient without consent, including one who withdraws after queueing; reminders once/only with consent/not when cancelled; worker pass; token encrypted; a CSV with one bad row imports nothing; idempotent import; duplicates refused), e2e 16 scenarios (consent → broadcast → worker → 1 sent; bad file refused, clean file imported)

Bugs found and fixed during Phase 8:
- Consent lookup ordered by a column name that did not exist (`recorded_at` maps to `created_at`)
- Several consent changes in one transaction share a timestamp; ordering now uses a strictly increasing identity column

Notes:
- Production needs `DATA_ENCRYPTION_KEY` and `WHATSAPP_DRIVER=cloud` (default in production); Meta business verification and template approval happen outside MedFlow
- The Docker `worker` image build was verified in Phase 10 and is built in CI

## Phase 9: Analytics ✅

- [x] Schema: `cohorts` (name, required purpose, definition with required date window, version, per-cohort salt), `cohort_runs` and `analytics_exports` (append-only: definition, version, columns, size); clinic setting `analytics_min_cell` (default 5, DB CHECK 3–50, editable in Clinic settings when the module is on)
- [x] Overview (`/analytics`): patients, visits per month, age band × sex, most common diagnoses (patients per ICD-10 code), most prescribed generics, all counts with small-cell suppression; hidden months are gaps, totals never sit next to hidden cells
- [x] Cohorts: diagnosis prefixes, prescribed generics, sex, age range, inside a window of at most 3 years; purpose required; editing the criteria bumps the version; runs recorded; archive
- [x] Results: size (suppressed below the threshold), suppressed breakdowns, and up to 100 pseudonymous rows only when the cohort reaches the threshold
- [x] Pseudonyms: HMAC-SHA256 of the patient id with the cohort's own salt; stable within a cohort, unrelated across cohorts; the salt never leaves the server
- [x] Export (`analytics:manage`): CSV with a header block (cohort, version, purpose, definition, columns, time, pseudonym note), escaped cells, refused below the threshold, recorded and audited as a warning
- [x] Data quality (`/analytics/quality`): age-only records, unknown sex, no mobile, incomplete emergencies, signed consultations without diagnosis/vitals, uncoded diagnoses, prescription lines without quantity, lab tests waiting over 7 days
- [x] Strict inputs: every analytics action and the cohort definition reject unknown fields; ESLint also stops analytics screens from importing patient components or services
- [x] Analyst lands on `/analytics`; "Analytics" in the nav for `analytics:read` (Doctors can view, Analysts can also build and export)
- [x] Tests: 1015 unit + integration. Proofs: every analytics action refuses a patient name, mobile, record number or id (permission matrix); no overview, quality, run or export output contains a seeded name, mobile or MRN; the same patients get unrelated keys in two cohorts; small cohorts suppressed and not exportable; runs/exports append-only. e2e 17 scenarios (the Analyst sees "<5" and no names, cannot export a small cohort, gets 403 on patient screens)

Bugs found and fixed during Phase 9:
- A hidden month counted as zero made "visits in 12 months" read 0; hidden months are now gaps and the total says when it leaves some out

## Phase 10: Hardening & launch ✅

Security
- [x] Independent security review against the plan's guarantees: 10 findings, all fixed and tested (`security-hardening` unit + integration). Table in [SECURITY.md](SECURITY.md#phase-10-security-review)
  - Session versions need a server-minted HMAC proof (`lib/auth/session-proof.ts`); clinic sessions capped at 8 h from sign-in
  - Client IP from the right of `X-Forwarded-For` (`TRUST_PROXY_HOPS`); password-change rate limits
  - Consultation ownership with audited take-over; Analyst role limited to `analytics:*`; no dispensing beyond the prescribed course
  - `describeError` keeps query parameters out of logs; console tenant page uses the provisioner pool only for Platform Admins
  - Analytics: whole months, 5-year age steps, k-anonymous export rows, escaped CSV header
- [x] Content Security Policy with a per-request nonce (`lib/csp.ts`, `proxy.ts`); e2e asserts no violations on every screen
- [x] OWASP Top 10 checklist in [SECURITY.md](SECURITY.md#owasp-top-10-2021-checklist)
- [x] Dependency audit: 0 production vulnerabilities; unused bcrypt, react-hook-form and resolvers removed; `npm audit --omit=dev --audit-level=high` in CI

Performance
- [x] Load test `npm run load:clinic-day`: full visit journey with queue pollers. 400 visits at 16 in flight: 30.5 visits/s, every step p95 ≤ 107 ms. 2,000 at 40 in flight: 35.7 visits/s, p95 ≤ 203 ms, 0 failures
- [x] Found and fixed: invoice numbering held the counter lock for the whole transaction (p95 3.6 s at 40 in flight). Invoices are now numbered last (0.2 s)

Operations
- [x] Backup (`scripts/ops/backup.sh`) and restore into a new database (`restore.sh`); `npm run ops:verify-restore` checks row counts, migrations, RLS, triggers, append-only audit and app-role isolation. Drill passed: 62 tables / 2,335 rows identical
- [x] Monitoring: `/api/health` reports database and worker heartbeat (`sys.heartbeats`, migration 0012)
- [x] Log rotation in docker compose (20 MB × 10 per service); retention guidance in [OPERATIONS.md](OPERATIONS.md)
- [x] First `docker compose up` on a machine with the v1 stack failed ("database medflow does not exist"): same project name, so v2 reused v1's volume, where the image skips creating `POSTGRES_DB`. v2 now has its own volume (`medflow_data`), setup creates a missing database (`ensureDatabase`), and the healthcheck no longer depends on it
- [x] CI: e2e job (Postgres, migrations, production build, full Playwright run, artifacts on failure); worker image built in the docker job

Scheduling backlog
- [x] Doctor leave days (`schedule_exceptions`, migration 0013): no slots offered, existing bookings flagged "{n} booked: move them"
- [x] One-step reschedule: the old slot is released only if the new one is free

Documentation
- [x] README and ARCHITECTURE rewritten for v2; new SECURITY.md, OPERATIONS.md
- [x] User guides per role in [docs/user-guide/](user-guide/README.md) (Super Admin, Clinic Admin, Receptionist, Nurse, Doctor, Lab Technician, Pharmacist, Analyst, Auditor)
- [x] [UAT checklist](UAT_CHECKLIST.md) for the pilot clinic, with severities and sign-off

Final verification (2026-10-16)
- `tsc` and ESLint clean; drizzle-kit check clean, no schema drift
- Vitest: 1,056 tests (931 unit, including the generated permission matrix; 125 integration against Postgres)
- Playwright: 19 scenarios passed against a production build (every role, leave + reschedule, CSP)
- Production build passes; `npm audit --omit=dev`: 0 vulnerabilities

Remaining before go-live (outside the codebase)
- UAT with the pilot clinic using the checklist
- Production host, TLS proxy, off-site backup storage and uptime monitor (OPERATIONS.md)
- Meta WhatsApp business verification and template approval
- Recommended next: multi-factor sign-in for the console and Clinic Admins

---

## Summary

All eleven phases (0–10) of the implementation plan are built and verified. MedFlow v2 is a multi-clinic EMR with a Super Admin console, per-clinic administration and eight staff roles, covering front desk, triage, consultation, lab, billing, pharmacy, compliance, messaging, import and de-identified analytics. Clinic isolation, immutability and audit are enforced in the database. The patient portal stays hidden (D1) and the medicine list is a customisable starter set (D6). Nothing has been committed yet: the work is ready for review and a first commit on `production-hardening`.

---

## Branding: NuvaLyf ✅
- [x] Product renamed to **NuvaLyf**: page titles (root title template), sign-in screens, console, PDFs, docs and user guides
- [x] Logo assets from the client's files in `public/brand/` (trimmed wordmark, white-lettered version for dark mode, stethoscope mark); favicon, app icon and Apple touch icon generated from the mark
- [x] Clinic panel accent retuned to the logo's teal and green (`--brand-teal`, `--brand-green` in `globals.css`); compliance (sky) and console (violet) keep their own accents
- [x] Technical identifiers unchanged (package, database roles, cookies, Docker project) so existing installs and sessions are unaffected

## Client request: supplier bills & item names ✅

From the client's voice notes (in-house pharmacy runs off supplier bills; companies name the same item differently).

- [x] **Supplier bill entry** (`/pharmacy/purchases/bills/new`): supplier, bill number and date; lines with batch, expiry (MM/YY), packs, free packs, units per pack, rate, MRP and GST. Saving books (qty + free) × pack units through the stock ledger, records the bill (append-only) and can set selling prices from the MRP. One bill number per supplier; idempotent
- [x] **Item types**: medicine, consumable, instrument. Only medicines can be prescribed; all are stocked and sold. Items also carry manufacturer and units per pack
- [x] **Other names**: an item can be known by any number of names (unique per clinic). Search matches words in any order across name, generic, manufacturer and other names; a new spelling confirmed on a bill is remembered. A name can never point at two items
- [x] **Items & opening stock import** (`/pharmacy/stock/import`): CSV with types, other names and batches; matches existing items by any name; all or nothing; idempotent
- [x] Migration 0014; tests: 11 unit, 16 integration, 1 new e2e scenario (20 in total)
- [x] **Selling by the strip and by the tablet** (client: "both"): each sale or dispensing line is loose units or packs. A pack sells at the item's pack price (set from the MRP on bills, editable, importable), so a strip costs exactly its MRP; stock always moves in units, and the course limit counts units. Receipts read "2 strips (30 tablets)". Migration 0015
- Deferred, to decide with the client: photographing a bill to fill the form automatically

---

## Decisions log

| Date | Decision |
|---|---|
| 2026-10-16 | D1: patient portal kept but hidden; v1 portal code parked in `legacy/v1` |
| 2026-10-16 | D6: basic starter medicine list, everything customizable per clinic |
| 2026-10-16 | No `FORCE ROW LEVEL SECURITY`: the owner role is migration-only, and platform usage counts come from owner-defined views |
| 2026-10-16 | Product name NuvaLyf; technical name `medflow` kept in code, database and infrastructure |
| 2026-10-16 | Users can hold several roles; effective permissions are the union, filtered by enabled modules |
