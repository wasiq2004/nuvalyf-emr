# MedFlow v2: Implementation Plan

**Status:** Draft for approval · **Prepared:** October 2026
**Source:** the eight role flow diagrams (Receptionist, Doctor, Nurse, Pharmacist, Clinic Admin, Analyst, Auditor, Super Admin)

---

## 1. What we are building

MedFlow becomes a **multi-clinic platform**. One deployment serves many clinics, and each clinic's data is walled off from every other clinic's by the database itself.

There are three layers of access:

```
┌──────────────────────────────────────────────────────────────────────┐
│ LAYER 1: PLATFORM (Operations console, /platform)                     │
│   Super Admin (Platform Admin) · Platform Operator                    │
│   Onboards clinics, sets plans/modules, suspends/restores.            │
│   Sees no patient data of any kind.                                   │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ creates clinic + its first admin
┌──────────────────────────────▼───────────────────────────────────────┐
│ LAYER 2: CLINIC ADMIN (Clinic panel, /settings, /reports, /billing)   │
│   Runs one clinic: settings, staff accounts, services, schedules,     │
│   import, WhatsApp, reports. Reads the clinical record, never writes. │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ creates staff logins
┌──────────────────────────────▼───────────────────────────────────────┐
│ LAYER 3: CLINIC STAFF (each with their own login)                     │
│   Clinic panel:  Receptionist · Nurse · Doctor · Pharmacist · Analyst │
│   Compliance panel (/audit): Auditor                                  │
└──────────────────────────────────────────────────────────────────────┘
```

**The rule behind every screen:** each role is defined by what the **server refuses** it, not by what the screen hides. Hidden buttons are cosmetic; permissions, database grants and row-level security are the real controls.

### A patient visit, end to end

```
Receptionist           Nurse              Doctor                    Pharmacist        Receptionist
register / book  ──▶  triage:      ──▶   consultation:      ──▶   dispense     ──▶  invoice +
check in (ARRIVED)    vitals,            diagnosis, Rx,           against batch,     payment
wait clock starts     allergies          sign & finalise          ring up sale
                      → READY            → Rx to pharmacy queue
        ▲
        └── EMERGENCY button (desk, nurse, admin): one-field registration, front of queue
```

---

## 2. Decisions and assumptions

D1 and D6 are **confirmed by the client**. The rest are recommended defaults; change any of them before Phase 1 starts.

| # | Question | Decision |
|---|---|---|
| D1 ✅ | Do patients keep their own login (the current self-booking portal)? | **Kept, but hidden.** The portal code stays in the codebase behind a `patient_portal` module that is **off for every clinic**. Patient login, self-registration and the `/patient` routes are unreachable while it is off (server-enforced, not just hidden links). Staff manage patient records in the meantime. Re-enabling it later is its own phase (see §5, "Later"). |
| D2 | How do staff sign in when there are many clinics? | **Clinic code + email + password** at `/login`. Email is unique within a clinic. Subdomains (`clinic.medflow.app`) can come later. |
| D3 | Existing data | Demo only. **Tag the current code as `v1.0`** and start v2 from a clean schema baseline. Nothing is migrated. |
| D4 | Departments | **Replaced by Services** (name + duration). A doctor's specialty becomes a field on the staff profile. |
| D5 | Diagnosis coding | **ICD-10** catalogue, loaded as reference data. |
| D6 ✅ | Drug catalogue and interaction data | **Ship a basic starter medicine list; everything is customizable per clinic.** Each clinic gets its own editable copy of the starter drugs, interaction rules and allergy classes, and can add, edit or deactivate any entry. See §3.8. A commercial interaction database can be plugged in later as another source. |
| D7 | Payments | **Recorded, not processed**: cash / UPI / card / other entered by staff. No payment gateway in v2. |
| D8 | Lab results: who enters them? | No lab role exists in the diagrams. Assume a **Lab Technician** role (optional, part of the Lab module) that enters results; results route back to the ordering doctor. |
| D9 | WhatsApp provider | **Meta WhatsApp Cloud API** directly. Business verification takes weeks, so start it early (see Risks). |
| D10 | Emergency permission for doctors | Not stated in the diagrams. Default **yes** (configurable per clinic). |
| D11 | Hosting | Docker (as now): app + Postgres + a background worker. No Redis needed (jobs and rate limits use Postgres). |

---

## 3. Target architecture

### 3.1 Tenancy: one database, isolated clinics

- A `clinics` table. **Every clinic-owned table carries `clinic_id`.**
- **Postgres Row-Level Security (RLS)** on every clinic table:
  `USING (clinic_id = current_setting('app.clinic_id')::uuid)` with `FORCE ROW LEVEL SECURITY`.
- Each request runs inside a transaction that first sets
  `set_config('app.clinic_id', <clinic>, true)` and `set_config('app.user_id', <user>, true)`.
  One helper does this (`withClinic(session, fn)`); services never open their own connections.
- A bug in a query **cannot** leak another clinic's rows: the database returns nothing.

### 3.2 Database roles: least privilege by construction

| DB role | Used by | Can | Cannot |
|---|---|---|---|
| `medflow_owner` | Migrations only | Owns schema | Never used at runtime |
| `medflow_app` | Clinic + compliance panels | Clinic tables, always filtered by RLS | Bypass RLS; update/delete audit rows; touch platform tables |
| `medflow_platform` | Operations console | Clinics, plans, operators, usage **counts** (via views) | Any grant on any clinical table |
| `medflow_provisioner` | Exactly two actions: onboard clinic, rescue clinic admin | Insert/update clinic user accounts | Anything clinical |

`medflow_provisioner` has its own connection string (`PROVISIONER_DATABASE_URL`). If it is absent, onboarding and rescue switch themselves off with a clear message instead of failing mid-way.

### 3.3 Authentication

| | Clinic + compliance panels | Operations console |
|---|---|---|
| Login | `/login` (clinic code + email + password) | `/platform/login` |
| Session cookie | `medflow.clinic` | `medflow.platform` (different name **and** token audience) |
| Session length | 8 hours | **1 hour, no refresh** |
| A session from the other side | grants nothing | grants nothing |

- Passwords hashed with **argon2id**.
- New accounts get a **generated one-time password, shown once**, never stored in plain text, never recoverable. First login forces a password change.
- Issuing a replacement password is a separate, audited action.
- Every clinic request re-reads `clinics.status`: a **suspended clinic stops working immediately**.
- Login rate limiting moves to Postgres so it works across multiple app instances.

### 3.4 Authorization: permissions, not role names

Code checks **permissions** (`requirePermission("prescription:sign")`), never role names. Roles are bundles of permissions with defaults, stored per clinic so a clinic can adjust the adjustable ones (e.g. give the pharmacist `purchase:approve`).

**Default permission matrix** (✔ = granted by default, R = read-only, ◐ = limited view)

| Permission | Clinic Admin | Receptionist | Nurse | Doctor | Pharmacist | Analyst | Auditor | Lab Tech |
|---|---|---|---|---|---|---|---|---|
| `patient:read` | ✔ | ✔ (demographics) | ✔ | ✔ | ◐ name/age/allergies | — | — | ◐ |
| `patient:create` / `:update` | ✔ | ✔ | — | — | — | — | — | — |
| `emergency:admit` | ✔ | ✔ | ✔ | ✔ (D10) | — | — | — | — |
| `appointment:manage` | ✔ | ✔ | — | R | — | — | — | — |
| `queue:checkin` | ✔ | ✔ | — | — | — | — | — | — |
| `queue:call` | — | — | ✔ (triage) | ✔ | — | — | — | — |
| `encounter:read` | R | — (exists only) | ✔ | ✔ | — | — | — | — |
| `vitals:write`, `allergy:write` | — | — | ✔ | ✔ | — | — | — | — |
| `encounter:write` / `:finalize` | — | — | — | ✔ | — | — | — | — |
| `prescription:sign` | — | — | — | ✔ (needs reg. no.) | — | — | — | — |
| `lab:order` / `lab:result` | — | — | — | order | — | — | — | result |
| `pharmacy:dispense`, `pharmacy:sell` | — | — | — | — | ✔ | — | — | — |
| `stock:manage`, `purchase:create` | — | — | — | — | ✔ | — | — | — |
| `purchase:approve` | ✔ | — | — | — | grantable | — | — | — |
| `billing:manage` | ✔ | ✔ | — | — | — | — | — | — |
| `settings:manage`, `staff:manage` | ✔ | — | — | — | — | — | — | — |
| `broadcast:send` | ✔ | — | — | — | — | — | — | — |
| `reports:read` | ✔ | — | — | — | — | — | — | — |
| `analytics:read` | — | — | — | R | — | ✔ | — | — |
| `audit:read` | ✔ (in reports) | — | — | — | — | — | ✔ | — |

**Modules** add a second gate: `requireModule("pharmacy")`. A clinic's plan decides which modules are on.

| Module | Optional? | Notes |
|---|---|---|
| Core (patients, appointments, queue, consultations, prescriptions, billing, audit) | Always on | |
| Pharmacy | Optional | Finalised prescriptions only reach a pharmacy queue if this is on |
| Lab | Optional | Adds lab orders/results and the Lab Technician role |
| WhatsApp messaging | Optional | Reminders + consent-gated broadcasts |
| Reports | Optional | Collections, outstanding, visit volume |
| Analytics | Optional | **Requires Reports** (enforced) |
| Patient portal | **Hidden** (decision D1) | Existing patient login + self-booking. Off for every clinic and not offered on any plan until re-enabled in a later phase |

A clinic with **no plan** has every optional module off; the console warns before and after onboarding.

### 3.5 Three panels, structurally separate

```
app/
  (auth)/login                    clinic sign-in
  (clinic)/                       Clinic panel layout (clinic session required)
    today, patients, appointments, queue, encounters/[id],
    pharmacy/…, billing/…, lab/…, settings/…, reports, analytics/…
  (compliance)/audit/…            Compliance panel: own layout and own component folder
  (platform)/platform/…           Operations console: own auth, own layout
```

A lint rule (`no-restricted-imports`) stops `(compliance)` and `(platform)` from importing any component that renders patient data, so the separation is enforced in code review and CI, not just by convention.

### 3.6 Integrity mechanisms

| Mechanism | Where it applies | How |
|---|---|---|
| **Append-only audit** | `audit_events` | DB trigger rejects UPDATE/DELETE, even for the owner role. Rows carry actor, action, target, **patient_id**, outcome (`success`/`denied`/`error`), IP, time. Indexed on `(clinic_id, patient_id, at)`. Denied authorisations are logged as serious. Reading the log is itself logged. |
| **Immutable clinical record** | Finalised consultations and prescriptions | Trigger blocks updates once `finalized_at` is set. Corrections go into `encounter_amendments` (addenda); the original stays. |
| **Add-only allergies** | `allergies` | No delete. A correction is an update with a mandatory reason, kept in history. |
| **Idempotency** | Payments, pharmacy sales, stock receipts | Client mints one key per user attempt; `idempotency_keys(clinic_id, scope, key)` is unique; a retry returns the first result. |
| **Search before create** | Patient registration | The duplicate search returns a short-lived signed token; registration refuses without it. Overriding a likely duplicate requires a written reason, stored and visible later. |
| **Server-side clinical logic** | Vitals flags, allergy/interaction checks, registration-number gate | Computed on the server from reference data, never trusted from the form. |
| **Stated age** | Patients without a date of birth | Stored with the date it was stated; current age is derived, so paediatric dosing does not silently rot. |

### 3.7 Supporting services

| Need | Choice |
|---|---|
| Background jobs (reminders, broadcasts, import processing, expiry alerts) | **pg-boss** (Postgres-backed queue) in a separate `worker` container |
| Prescription / invoice PDFs with clinic letterhead | `@react-pdf/renderer` |
| Letterhead/logo uploads | S3-compatible storage (MinIO locally) |
| Migrations | **drizzle-kit versioned migrations** plus custom SQL migrations for RLS policies, DB roles and triggers (replaces the single idempotent SQL file) |
| Tests | Vitest (unit), Vitest + real Postgres (integration, RLS), **Playwright** (one end-to-end test per role flow) |

### 3.8 Customization: starter defaults, owned by each clinic

**Rule:** MedFlow ships sensible defaults, but **every clinic owns and can edit its own copy**. Nothing clinical or operational is hard-coded.

**How it works**

1. The platform keeps **starter templates** (a basic medicine list, common interactions, allergy classes, vital ranges, default roles, message templates).
2. When a clinic is onboarded, the starter templates are **copied into that clinic's own tables**. From then on the clinic edits its copy; one clinic's changes never affect another.
3. Entries are **deactivated, never deleted**, so old prescriptions and invoices keep pointing at valid data.
4. Signed prescriptions **snapshot** the drug name, strength and dose at signing. Editing the catalogue later never changes a signed document.
5. When the platform improves the starter list, clinics see "new starter entries available" and **choose** whether to import them.

**What each clinic can customize** (Clinic Admin unless noted)

| Area | Customizable |
|---|---|
| Medicines (Pharmacist + Admin) | Name, generic name, form, strength, category, default dose/frequency/duration, price, reorder level, active/inactive; add their own drugs |
| Interaction & allergy checks | Add/edit/deactivate interaction rules and their severity; map drugs to allergy classes |
| Prescribing presets | Frequency options (OD, BD, TDS…), duration presets, instruction phrases (e.g. "after food"), in any language |
| Diagnoses | ICD-10 stays standard, but clinics keep a **favourites list** and can add clinic-specific codes/labels |
| Services & schedules | Services, durations, prices; each doctor's weekly schedule |
| Vitals | Reference ranges per age band, units |
| Roles & permissions | Adjustable grants within safe limits (e.g. give the pharmacist `purchase:approve`); core safety rules (only doctors sign) cannot be removed |
| Documents | Letterhead, logo, prescription and invoice layout/footer text |
| Messaging | WhatsApp templates, reminder timing |
| Billing | Payment methods, tax settings, invoice numbering |
| Queue & clinic | Timezone, working days, slot length, emergency permission for doctors |
| Analytics | Small-cell suppression threshold (minimum enforced by the platform) |

---

## 4. Data model (by domain)

All tables below except Platform carry `clinic_id` and RLS.

**Platform** (no RLS; only `medflow_platform` / `medflow_provisioner` reach them)
`clinics` (name, code, status, plan_id, timezone) · `plans` · `plan_modules` · `platform_operators` (role: admin/operator) · `platform_audit_events`

**Identity & access**
`users` (email, argon2 hash, must_change_password, status) · `staff_profiles` (display name, specialty, **medical registration number**) · `roles` · `role_permissions` · `user_roles` · `login_attempts`

**Clinic settings**
`clinic_settings` (letterhead, address, timezone, print options) · `services` (name, duration, price) · `schedules` (doctor, weekday, start, end, service set)

**Patients**
`patients` (MRN, names, sex, DOB *or* stated age + stated-on date, mobile, address, `is_emergency_placeholder`, emergency label) · `duplicate_overrides` (reason, by, at) · `consents` (type, granted/withdrawn, at, by) · `allergies` + `allergy_history` · `tasks` (type, priority incl. URGENT, assignee, status)

**Scheduling & queue**
`appointments` (patient, doctor, service, starts_at, status) · `visits` / `queue_entries` (status: `booked → arrived → in_triage → ready → with_doctor → done`, `is_emergency`, companion phone, arrived_at, called_at, position)

**Clinical**
`encounters` (visit, doctor, status draft/finalised, finalised_at/by) · `vitals` (values + server-computed flags) · `vital_reference_ranges` (by age band) · `diagnoses` (ICD-10 code) · `encounter_notes` · `private_notes` (author-only) · `encounter_amendments` · `prescriptions` + `prescription_items` (drug, dose, frequency, duration) · `prescription_clarifications`

**Catalogues** (see §3.8)
Shared, read-only: `icd10_codes`
Platform starter templates (no RLS, copied at onboarding): `starter_drugs` · `starter_interactions` · `starter_allergy_classes` · `starter_vital_ranges` · `starter_message_templates`
Per clinic (RLS, fully editable, deactivate-not-delete): `drugs` · `drug_interactions` · `allergy_classes` · `drug_allergy_classes` · `prescribing_presets` · `diagnosis_favourites` · `custom_diagnoses`

**Lab** (module)
`lab_orders` · `lab_results` (read_at by ordering doctor)

**Pharmacy** (module)
`stock_items` · `stock_batches` (batch no., expiry, qty) · `stock_movements` (ledger: never edit quantities directly) · `dispensations` · `pharmacy_sales` · `purchase_orders` + items · `stock_receipts` · `idempotency_keys`

**Billing**
`invoices` + `invoice_items` · `payments` (method, amount, idempotency key)

**Messaging** (module)
`whatsapp_config` · `message_templates` · `broadcasts` · `message_log`

**Import**
`import_jobs` · `import_job_errors` (the batch commits in one transaction, or not at all)

**Analytics** (module)
`cohorts` (definition, version, **required date window**, **required purpose**, per-cohort salt) · `cohort_runs` · `analytics_exports` (definition + version + column list)

**Audit**
`audit_events` (append-only, as in §3.6)

---

## 5. Phased roadmap

Estimates assume **one full-time developer**. Every phase ends with a working, demoable build, its own automated tests, and a short demo to the client.

### Phase 0: Foundations · ~1.5 weeks
De-risk the hard architectural parts before building screens on them.

- Tag current code `v1.0`. Start v2 schema baseline with drizzle-kit migrations.
- Create the four DB roles; RLS policy framework; `withClinic()` transaction helper.
- **Spike + automated test:** a request for clinic A provably cannot read, update or count clinic B's rows (tested at the DB level, not through the UI).
- Append-only audit table + trigger + test that DELETE fails even as owner.
- Integration-test harness with real Postgres in CI; Playwright set up.
- pg-boss worker container wired into docker compose.

**Done when:** RLS isolation and audit immutability tests pass in CI.

### Phase 1: Platform layer (Super Admin) · ~2 weeks
- Separate platform auth (`/platform/login`, own cookie/audience, 1-hour session).
- Plans and modules management; module-dependency rule (Analytics needs Reports).
- Onboard a clinic + its first admin → one-time password shown once. Warnings when no plan.
- Clinic list with status and usage counts (counts only, via views).
- Suspend / restore (enforced on every clinic request).
- Operators management (Platform Admin only) and **rescue a locked-out clinic admin** (provisioner role).
- Clinic login (`/login` with clinic code), forced first-login password change, argon2.
- Onboarding copies the starter templates (medicines, interactions, allergy classes, vital ranges, roles) into the new clinic (§3.8).
- **Hide the patient portal:** `patient_portal` module off by default; `/patient/*`, patient sign-up and patient login refuse requests while it is off.

**Done when:** an operator can onboard a clinic, its admin can sign in and change their password, suspending the clinic locks every staff session out on the next request, and every patient-portal route and action is refused (tested).

### Phase 2: Clinic Admin & staff · ~2 weeks
- `/settings/clinic`: name, letterhead, address, timezone.
- `/settings/users`: create staff with roles, one-time password, re-issue (audited), deactivate. Doctors' registration number.
- Permission engine + default role bundles + per-clinic adjustable grants.
- `/settings/services` and doctor schedules (reusing the existing, tested slot engine).
- Navigation and `/today` that adapt to the signed-in role's permissions.

**Done when:** an admin can create one account per role, and an automated **permission matrix test** proves every server action refuses every role that should not call it.

### Phase 3: Front desk (Receptionist) · ~2 weeks
- `/patients` search (name, mobile, MRN; shared family mobiles handled).
- `/patients/new` gated by a duplicate-search token; written reason to override a likely duplicate.
- **Emergency button** in the header: one required field, skips duplicate search, front of queue, creates an URGENT task to complete the record.
- `/appointments/new`: book a slot or add a walk-in.
- `/queue`: check-in (ARRIVED, wait clock starts); emergencies always sort first by flag.
- `/today` for the desk: booked, arrived, unpaid.

**Done when:** the receptionist flow from the diagram runs end-to-end in Playwright, including an emergency admission.

### Phase 4: Clinical (Nurse + Doctor) · ~4 weeks
- Nurse: pick up from queue, vitals with server-side age-based flags, allergies (add-only, reasoned corrections), hand over as READY.
- Doctor: `/today` (waiting, wait time, unread results), call next (wait clock stops), consultation screen with allergies always visible.
- ICD-10 diagnosis search; clinical notes; private notes (author-only, never printed, hidden from admin).
- **Medicine catalogue & prescribing settings screens:** clinics add/edit/deactivate drugs, interaction rules, allergy-class mappings, frequency/duration/instruction presets and diagnosis favourites, starting from the basic starter list.
- Prescriptions with **live allergy + interaction check as each drug is chosen**, using the clinic's own rules; signed prescriptions snapshot drug details.
- Registration-number gate shown when the consultation opens; enforced again at signing.
- Sign & finalise → record becomes immutable; amendments as addenda.
- Prescription PDF on clinic letterhead.
- Lab module: orders, result entry (Lab Tech), results return to ordering doctor and stay visible until read.

**Done when:** nurse → doctor flows pass end-to-end; a finalised prescription cannot be changed by anyone, including through direct action calls.

### Phase 5: Billing · ~1.5 weeks
- Invoices from services/visits; record payments (cash/UPI/card/other).
- Idempotent payment endpoint (double-tap and retry return the first payment).
- Outstanding balances on `/today` and the patient.

**Done when:** a scripted double-submit of a payment produces exactly one payment.

### Phase 6: Pharmacy · ~3 weeks
- Stock linked to the clinic's own (customizable) medicine catalogue: stock items, prices, reorder levels, batches with expiry, stock-movement ledger.
- Prescription queue (finalised only, module-gated); fill each line from a specific batch with expiry check at fill time.
- Clarification requests back to the prescriber (no edits to prescriptions).
- Counter sales: payment + stock movement in one transaction, idempotent.
- Alerts: expiring, below reorder level, slow-moving.
- Purchase orders → approval (separate permission) → receiving (idempotent).
- Pharmacist sees only name, age, allergies and source visit.

**Done when:** pharmacist flow passes end-to-end; retried receipts/sales do not double stock or charges.

### Phase 7: Compliance & reports · ~1.5 weeks
- Compliance panel (`/audit`) with its own layout: filter by person, patient, date, outcome; "who opened this record" lookup.
- Aggregate audit reports; reading the log is logged; consent events visible (not content).
- Clinic `/reports`: collections, outstanding, visit volume, audit trail summary.

**Done when:** the auditor can answer "who opened patient X's record last month" and cannot reach any patient screen or endpoint.

### Phase 8: Messaging & import · ~2 weeks
- WhatsApp Cloud API connection per clinic; appointment reminders via the worker.
- Broadcasts gated on consent; compose screen shows how many patients are excluded before sending.
- `/settings/import`: CSV upload, full validation report, **all-or-nothing** commit; stated ages stored with the import date.

**Done when:** a broadcast never reaches a non-consenting patient (tested), and a CSV with one bad row imports nothing.

### Phase 9: Analytics · ~2 weeks
- Overview (counts and bands only).
- Cohorts with required date window and purpose; pseudonyms salted per cohort.
- Small-cell suppression (configurable threshold, default 5): suppressed cells return null with a suppressed-count.
- Data-quality view (missing/uncoded fields).
- Exports carrying definition, version and column list.

**Done when:** tests prove no analytics endpoint accepts or returns a name, mobile number or MRN, and the same patient gets unrelated keys in two cohorts.

### Phase 10: Hardening & launch · ~1.5 weeks
- Security review against this plan's guarantees; dependency audit; OWASP checklist.
- Load test (queue + consultation at realistic clinic volume).
- Backups and restore drill, monitoring/alerting, log retention.
- User documentation per role; UAT with a pilot clinic.

### Later: Patient portal re-enable · ~2 weeks (when requested)
- Rework the existing portal for multi-clinic: a patient account links to records in one or more clinics.
- Self-booking against clinic services and schedules; patient sees own appointments, prescriptions and invoices (finalised only).
- Patient sign-up matches existing records via the same duplicate rules as the desk.
- Enabled per clinic by turning on the `patient_portal` module in its plan.

### Timeline summary

| Phase | Scope | Est. | Cumulative |
|---|---|---|---|
| 0 | Foundations (RLS, roles, audit, test harness) | 1.5 wk | 1.5 wk |
| 1 | Platform layer / Super Admin | 2 wk | 3.5 wk |
| 2 | Clinic Admin & staff | 2 wk | 5.5 wk |
| 3 | Front desk | 2 wk | 7.5 wk |
| 4 | Nurse + Doctor (+ Lab, medicine catalogue) | 4 wk | 11.5 wk |
| 5 | Billing | 1.5 wk | 13 wk |
| 6 | Pharmacy | 3 wk | 16 wk |
| 7 | Compliance & reports | 1.5 wk | 17.5 wk |
| 8 | Messaging & import | 2 wk | 19.5 wk |
| 9 | Analytics | 2 wk | 21.5 wk |
| 10 | Hardening & launch | 1.5 wk | **~23 weeks** |
| Later | Patient portal re-enable | ~2 wk | when requested |

**First usable release (pilot-ready):** after Phase 5 (~13 weeks): a clinic can be onboarded, staffed, register and queue patients, run consultations, issue prescriptions and take payments. Pharmacy, compliance, messaging and analytics follow as module releases.

---

## 6. Testing strategy

| Layer | What it proves |
|---|---|
| Unit (Vitest) | Pure rules: slots, queue ordering, status transitions, vitals flags, interaction checks, pseudonymisation, suppression |
| Integration (Vitest + Postgres) | RLS isolation between clinics; audit immutability; finalised-record immutability; idempotency; all-or-nothing import |
| **Permission matrix** (generated) | Every server action × every role → allowed/refused exactly as §3.4 says. Runs in CI; a new action without a matrix entry fails the build |
| End-to-end (Playwright) | One scripted run per diagram: Receptionist, Nurse, Doctor, Pharmacist, Clinic Admin, Analyst, Auditor, Super Admin |

CI blocks merges on lint, typecheck, all test layers, build, and `npm audit --omit=dev`.

---

## 7. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| RLS combined with connection pooling leaks clinic context between requests | Cross-clinic data exposure | Context set only with `set_config(..., true)` inside a transaction; Phase 0 isolation tests; no session-level settings ever |
| Drug interaction data quality/licensing | Unsafe prescribing advice | Curated starter table clearly labelled; decision D6 on licensing a commercial source before go-live |
| WhatsApp Business verification takes weeks | Phase 8 blocked | Start Meta business verification in Phase 1 |
| Scope creep inside the clinical phase | Timeline slips | Phase 4 scope frozen at kick-off; extras go to a backlog |
| Regulatory requirements (India DPDP Act 2023; prescription format rules) | Rework or legal exposure | Review with the client's legal/medical advisor before Phase 4; this plan is not legal advice |
| Single developer bus factor | Delays | Docs per phase, ADRs for key decisions, high test coverage |

---

## 8. What happens to the current code

| Current piece | In v2 |
|---|---|
| Next.js / Drizzle / Auth.js foundation, Docker, CI | **Kept**, extended |
| Slot engine, timezone helpers, appointment status policy, tests | **Kept**, moved to per-clinic config |
| Audit logging | **Rebuilt** as append-only `audit_events` |
| `admin` / `doctor` roles | Become Clinic Admin / Doctor in the permission model |
| `patient` login and self-booking portal | **Kept but hidden** behind the `patient_portal` module, off everywhere (decision D1). Patient records are managed by staff until it is re-enabled |
| Departments | **Replaced** by Services (decision D4) |
| `scripts/init-db.sql` | Replaced by versioned migrations |

---

## 9. Immediate next steps

1. ~~Confirm D1 and D6~~ ✅ done. Confirm or change the remaining defaults D2–D5, D7–D11.
2. Tag `v1.0`, create the `v2` branch.
3. Start Phase 0: DB roles, RLS framework and the isolation test.
4. Start Meta WhatsApp Business verification in parallel.
5. Phase 0 review with the client, then begin Phase 1.
