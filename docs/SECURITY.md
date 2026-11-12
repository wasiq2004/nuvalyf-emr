# NuvaLyf security model

This document says what NuvaLyf guarantees, where each guarantee is enforced and how it is tested. It ends with the Phase 10 security review, its findings and their status.

To report a vulnerability, email the maintainers rather than opening a public issue.

## Guarantees

| # | Guarantee | Enforced by | Proven by |
| --- | --- | --- | --- |
| G1 | A clinic never sees another clinic's data | Row-level security on every `app.*` table, keyed on `app.clinic_id` set per transaction; composite `(clinic_id, id)` foreign keys | `security.test.ts`: every table, read and write, across two clinics |
| G2 | Super Admins and operators never see patient data | The console uses `medflow_platform`, which has no grant on any clinical table; usage counts come from owner-defined views | `security.test.ts`: the platform role has no access to clinic tables |
| G3 | Every staff action is authorised against the user's roles and the clinic's plan | `clinicAction` / `platformAction` wrappers re-check the session, permission and module against the database on every call | Generated permission matrix: every action × every role (unit tests fail on an action without an entry) |
| G4 | Suspension, deactivation and role changes take effect immediately | Page guards and action wrappers re-read user, roles and clinic status on every request; sessions carry a version checked against the database | `platform.test.ts`: a suspended clinic's live session and sign-in are refused |
| G5 | A signed consultation cannot be edited | Database triggers on notes, vitals, diagnoses and prescriptions after finalisation (SQLSTATE `MFL01`); corrections are append-only amendments | `clinical.test.ts` |
| G6 | The audit trail cannot be changed, even by the app | `audit_events` (clinic and platform) reject UPDATE, DELETE and TRUNCATE by trigger; the app role has INSERT only | `security.test.ts`, the restore drill |
| G7 | Auditors see who did what, never clinical content | Compliance panel shows an allow-list of detail fields; clinical fields are withheld and counted; ESLint stops compliance code importing clinical modules | `compliance.test.ts`, `audit.test.ts` |
| G8 | Analysts never see identifiable patients | Analytics actions accept only strict schemas (unknown fields rejected); output is per-cohort HMAC pseudonyms, 5-year age bands, whole months; cells below the clinic's threshold (default 5, minimum 3) are suppressed and small cohorts cannot be exported | `analytics.test.ts`: no seeded name, mobile, record number or id appears in any output |
| G9 | Stock and money cannot be double-counted | Stock ledger with a `quantity >= 0` CHECK; idempotency keys on payments, sales and imports; integer minor units | `pharmacy.test.ts`, `billing.test.ts`, load test |
| G10 | Clinical notes, lab documents and secrets are unreadable in the database, its files and its backups | AES-256-GCM in the application (`lib/crypto-core.ts`), each value bound to its column; the list is `lib/encrypted-fields.ts` | `encryption-at-rest.test.ts` reads every encrypted column as the owner and finds only ciphertext; `encryption.test.ts` |
| G11 | Every connection to the database is encrypted, and the server is verified | TLS 1.2+ with `DATABASE_SSL=verify-full` against our own CA; `db/pg_hba.conf` refuses any network connection without TLS; production refuses to start without the setting | `database-tls.test.ts`: plain, wrong-CA and wrong-name connections refused |
| G12 | A backup is useless to whoever takes it | Streamed into GnuPG (AES-256) to a public key; the private key is never on the server; the script refuses to write a plain dump | Backup checks: no plain header or patient text in the file, no decryption without the key, a changed byte is refused |
| G13 | A stolen password alone does not open a Clinic Admin's or an operator's account | TOTP two-step sign-in (RFC 6238), required for Clinic Admins and every operator; codes cannot be replayed; recovery codes are hashed and single-use | `totp.test.ts` (RFC test vectors), `two-step.test.ts` |

## Authentication

- **Two separate sign-ins.** Clinic staff and console operators use separate Auth.js instances with different cookies (`medflow.clinic`, `medflow.platform`) and secrets. Over https the cookies use the `__Secure-` prefix and are `HttpOnly`, `SameSite=Lax`.
- **Passwords** are hashed with argon2id. Accounts are created by an administrator with a one-time temporary password, which must be changed at first sign-in. New passwords must be at least 10 characters for clinic staff and 12 for console operators.
- **Two-step sign-in** (TOTP, any authenticator app). Required for Clinic Admins and every console operator, who are sent to set it up after their first password change and can open nothing else until they do. Optional for other staff. A code is accepted once (the last time step is stored), with one step of clock drift either way. Ten recovery codes are shown once and stored as SHA-256 hashes. The TOTP secret is encrypted in the database. A lost phone: another administrator resets it (audited, ends every session); for the only Platform Admin, `npm run db:reset-operator-mfa` on the server.
- **Session lifetime is absolute and never extended by activity:** 8 hours for clinic staff (a working shift) and 1 hour for the console.
- **Revocation.** A password change, deactivation or admin reset bumps the user's session version. Older cookies are rejected on their next request. A new version is accepted only with a server-minted HMAC proof (`lib/auth/session-proof.ts`), so a stolen cookie cannot revive itself through the Auth.js update endpoint.
- **Rate limits** are held in Postgres, so they apply across all app instances:

| What | Limit |
| --- | --- |
| Clinic sign-in, per clinic + email | 10 per 15 minutes |
| Clinic sign-in, per IP | 50 per 15 minutes |
| Console sign-in, per email | 5 per 15 minutes |
| Console sign-in, per IP | 20 per 15 minutes |
| Password change, per account | 5 per 15 minutes |

- **Client IPs** are taken from `X-Forwarded-For`, counting `TRUST_PROXY_HOPS` entries from the right, so a client cannot forge its address to dodge limits or poison the audit trail.

## Authorisation

Permissions are fine-grained (`patient:read`, `encounter:finalize`, `stock:manage`, ...) and grouped into roles. Every clinic gets the system roles (Clinic Admin, Receptionist, Nurse, Doctor, Pharmacist, Lab Technician, Analyst, Auditor) and can create custom ones. A user can hold several roles; their permissions are the union, filtered by the modules in the clinic's plan.

Separation-of-duty rules:

- **Clinic Admin** reads the clinical record but cannot write or sign it.
- **Doctors** need a registration number on file to sign. Only the doctor who owns a consultation can edit it, unless they explicitly take it over, which is audited.
- The system **Analyst** role can hold only `analytics:*` permissions. Granting it any other permission is refused.
- **Auditor** sees the audit trail with clinical content withheld.
- Access refusals are written to the audit trail with severity *critical*.

## Data protection

- **Browser to server:** TLS at the reverse proxy (see [OPERATIONS.md](OPERATIONS.md)). HSTS is sent, and the CSP upgrades insecure requests when `AUTH_URL` is https.
- **App to database:** TLS 1.2 or later, certificate and host name verified against the deployment's own CA. The database refuses unencrypted network connections. The web server and worker refuse to start without the setting.
- **In the database:** consultation notes (chief complaint, history, examination, plan, nursing notes), vitals notes, amendments, private notes, lab order and result notes, lab documents, pharmacist-doctor queries, discharge summaries, WhatsApp tokens and two-step secrets are encrypted by the application with AES-256-GCM. Each value carries its key's id and is bound to its table and column. Patient names, phone numbers, diagnoses, prescriptions and lab values stay readable to the database, because search, billing, reports and trends work on them, and are protected by disk encryption.
- **Keys:** `DATA_ENCRYPTION_KEY` is required (the server will not start without it in production) and can be rotated without downtime: `npm run ops:rotate-key` re-encrypts every value, and `--check` proves none remain under the old key.
- **Disk:** the volume holding the database, logs and local backups must be encrypted (cloud volume encryption or LUKS; OPERATIONS.md, "Disk encryption").
- **Backups:** encrypted before they reach disk (OpenPGP, AES-256) to a public key whose private half is kept off the server; a checksum is written beside each.
- **Exports:** audit CSV and analytics exports are themselves audited. CSV cells are escaped against formula injection.
- **Logs:** database errors pass through `describeError`, which drops query parameters so patient data does not reach server logs. Database connections are logged with time, user and client. Retention of 180 days in India is set on the host (`docker-compose.logging.yml`, `scripts/ops/check-log-retention.sh`).
- **Messaging consent** is an append-only event history. Broadcasts go only to patients whose latest event is an opt-in; reminders respect opt-outs.

## Browser protections

- **Content Security Policy** per request, with a fresh nonce (`lib/csp.ts`, set in `proxy.ts`). Scripts must carry the nonce (`'strict-dynamic'`); there are no third-party origins. `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security`.
- **Server Actions** are POST-only with Next's origin check. Input is validated with zod and errors returned to the browser never include internals.

## Database roles

| Role | Used by | Can |
| --- | --- | --- |
| owner | `db:migrate` only | Everything; never used by the running app |
| `medflow_app` | Clinic and compliance panels, worker | `app.*` under RLS; INSERT-only on audit; read-only on the shared `ref.*` reference lists; no `platform.*` |
| `medflow_platform` | Operations console | `platform.*` and owner-defined usage views; no clinical tables |
| `medflow_provisioner` | Clinic onboarding and admin rescue, by Super Admins only | Create a clinic, its settings, roles and first admin; reset a clinic admin |

None of the runtime roles is `SUPERUSER` or has `BYPASSRLS`. `FORCE ROW LEVEL SECURITY` is not used because the owner role never serves requests (decisions log, 2026-10-16).

## OWASP Top 10 (2021) checklist

| Risk | Status |
| --- | --- |
| A01 Broken access control | Four independent layers (proxy, page guard, action wrapper, RLS); generated permission matrix; cross-clinic tests on every table |
| A02 Cryptographic failures | argon2id passwords; AES-256-GCM for clinical notes, documents and secrets with rotatable keys; TLS 1.2+ to the database, verified; encrypted backups; `__Secure-` cookies, HSTS. Browser TLS is at the reverse proxy |
| A03 Injection | Drizzle parameterised queries. The few raw SQL fragments use tagged templates; identifiers are never built from input. CSV formula escaping |
| A04 Insecure design | Threat-driven guarantees (above), immutability and append-only enforced in the database |
| A05 Security misconfiguration | Strict CSP and security headers; database bound to localhost; required secrets fail fast; separate secrets per panel |
| A06 Vulnerable components | `npm audit --omit=dev --audit-level=high` in CI. 0 production vulnerabilities at launch; unused dependencies removed |
| A07 Identification and authentication failures | Rate limits, forced password change, TOTP two-step sign-in for administrators, absolute session caps, revocation with HMAC proofs |
| A08 Software and data integrity failures | Lockfile + `npm ci`; migrations checked against the schema in CI; idempotency keys |
| A09 Security logging and monitoring failures | Append-only audit of every write, sign-in and refusal; critical-severity summary in the compliance panel; worker heartbeat in `/api/health` |
| A10 SSRF | The only outbound call is to the fixed WhatsApp Cloud API host; no user-supplied URLs are fetched |

## Phase 10 security review

An independent review of the whole codebase against the guarantees above found ten issues. All are fixed and covered by tests (`security-hardening.test.ts`, unit and integration).

| # | Finding | Severity | Fix |
| --- | --- | --- | --- |
| 1 | The Auth.js update endpoint accepted a client-supplied session version, letting a stolen cookie survive a password change | High | Versions are accepted only with a server-minted HMAC proof |
| 2 | Clinic sessions were extended by activity with no absolute cap | Medium | `loginAt` stored in the token; 8-hour absolute limit |
| 3 | Client IP was read from the leftmost `X-Forwarded-For` entry, which clients control (bypasses per-IP limits, forges audit IPs) | Medium | `clientIp` counts `TRUST_PROXY_HOPS` from the right |
| 4 | Any doctor could edit another doctor's open consultation | Medium | Ownership enforced; explicit, audited take-over |
| 5 | A Clinic Admin could grant the Analyst role patient permissions, defeating de-identification | Medium | The Analyst role may hold only `analytics:*` |
| 6 | Some error logs could include query parameters (patient data) | Medium | `describeError` strips parameters and values |
| 7 | Pharmacy could dispense more than the prescribed course | Medium | Originally refused. **Removed at the client's request on 2026-11-06:** the pharmacist decides. Now recorded, not prevented; see [PHARMACY_DISPENSING.md](PHARMACY_DISPENSING.md) |
| 8 | The tenant detail page used the provisioner pool for plain operators | Low | Provisioner only for `platform_admin` |
| 9 | Password changes had no rate limit | Low | 5 per account per 15 minutes |
| 10 | Analytics accepted partial months and 1-year age steps, allowing differencing attacks; CSV header not escaped | Low | Whole months only, 5-year steps, k-anonymous rows by (age band, sex), escaped header |

## Known limitations and accepted risks

- **`style-src 'unsafe-inline'`** is required by React style attributes and UI libraries. Script injection is still blocked by the nonce.
- **Searchable patient data** (names, phone numbers, diagnoses, prescriptions, lab values) is protected by disk encryption, not by the application. Encrypting it in the application would break search, duplicate checks, billing and reports.
- **Two-step sign-in is optional for roles other than Clinic Admin.** A clinic that wants it for everyone can ask staff to turn it on; a per-clinic setting to require it is not built yet.
- **The setup page shows the key to type, not a QR code.** No QR library is bundled; the `otpauth://` link opens the authenticator app directly on a phone.
- **Lab documents keep a SHA-256 of the plain file**, used to refuse the same file twice. It reveals only whether a known file is stored.
- **An external security audit** (CERT-In empanelled, a WASA for ABDM) has not been done. Everything above is the team's own testing.
- **Patient portal** is hidden (decision D1). It needs its own review before it is switched on.
