# Lab reports

Every test reports its own list of parameters. A CBC has haemoglobin, platelets, the differential count and so on; urine routine has physical, chemical and microscopy findings. Code: `features/clinical/lab.service.ts`, `features/clinical/lab-rules.ts`, `lib/catalog/starter-lab.ts`.

## Data

| Table | Holds |
|---|---|
| `lab_test_parameters` | One row per parameter: name, report heading, unit, number or word, expected word |
| `lab_parameter_ranges` | Low, high and critical limits by sex and age band |
| `lab_results` | One row per reported value (append-only). `parameter_id` is empty for a parameter the technician added |
| `lab_documents` | One row per attached file: name, checked type, size, who and when, and any removal |
| `lab_document_files` | The file itself (append-only), apart so that listing documents never reads the bytes |

Each clinic has its own copy. Clinics edit them under Medicines & catalogues > Lab tests. Results saved before parameters existed are shown as they were.

## Entering a result

`/lab/orders/[id]` is one test: its parameters, anything added, notes, documents and, once saved, the result and a print button.

- **The parameters are simply there.** A starter test with none, in a clinic set up before they existed, gets them when it is opened (`ensureStarterParameters`). No one has to press Import. If the clinic has any parameter row for the test, even turned off, nothing is added.
- **Adding a parameter:** the technician can add any name, result, unit, range and flag, for this patient only. It prints under "Additional" and trends like any other. To add one to the test for everyone, the Clinic Admin edits the test.
- **A test with no list** opens with one row for the test itself, and more can be added.
- **A number parameter must be a number**, which keeps typing slips out of trends and flags. Something like "<0.5" goes in as an added parameter, which can hold any text.
- **A result can be just a document.** With nothing typed and a document attached, the technician must choose the interpretation, and the result reads "See attached document".
- **No range for this patient:** when age or sex is not recorded, an age- or sex-specific range cannot apply, so that value is not flagged. The form says so.

## Rules

- **Range:** a sex-specific range beats one for everyone; among those, the narrowest age band that fits wins. With no known age, only an all-ages range applies.
- **Flags** are decided on the server when the result is saved: normal, low, high, critical low, critical high. A word that differs from the expected word is abnormal.
- **Added parameters:** the technician's flag stands, except that a number outside the range they typed ("10 - 20", "< 5", "> 40") can never be saved as normal. A range in any other form prints as typed and is not checked.
- **Reports never change.** The name, unit, range text and flag are copied onto each result, so editing a range later does not alter an old report.
- **Units:** a parameter reported in a different unit gets its own row and its own trend line. Unlike values are never compared.

## Supporting documents

PDF, JPG or PNG, up to 10 MB each and 10 on a test. They can be attached before or after the result is saved, and never to a cancelled test.

| Rule | Why |
|---|---|
| The type comes from the file's first bytes; the browser's word and the file name are ignored | A disguised file is refused, and the app can only ever serve these three types |
| The patient and clinic come from the order and session, never the request | A document cannot be attached to someone else |
| The same file twice on a test is refused | A double-click is not a second document |
| Added after the doctor read the result: the result goes back to Unread | The doctor needs to know something new arrived |
| Removing needs a reason; the file and record stay, but it no longer opens, shows or prints | A wrong patient's report has to come off the record, and the record of that stays. A database trigger refuses any other change |
| The only document behind a "See attached document" result cannot be removed until its replacement is attached | The result would point at nothing |
| Every opening is audited, without the file name | Names often carry clinical detail |

Who can open one: anyone with `lab:result` or `encounter:read`, as for the report. Uploading and removing need `lab:result`.

**Where they show:** the entry page, the lab history page, the patient record (roles with clinical access), under the test on the consultation, and as a count on the doctor's Unread results.

**Storage:** in Postgres, in `lab_document_files`. Row-level security, backups and restore already cover it, and a self-hosted clinic needs no new service. It grows the database, so watch backup size. At real volume, move the bytes to object storage: only `lab-documents.service.ts` reads or writes that table.

**Body limits:** `next.config.ts` sets both `serverActions.bodySizeLimit` and `proxyClientMaxBodySize` to 11 MB. Past the second, `proxy.ts` silently cuts the body short. An nginx in front needs `client_max_body_size` too (OPERATIONS.md).

## Outputs

- `/lab/report/[encounterId]`: the printable report for a consultation. Out-of-range values are bold and marked L, H, LL, HH, * or **. Attached documents are listed, then follow as pages of the same PDF: a PDF keeps its pages, a photo gets an A4 page turned the way the phone recorded, and each added page names the patient. A file that cannot be added (corrupt, password-protected, or past the 40 MB print limit) gets a page saying so, and the report still prints.
- `/lab/documents/[id]`: opens one document.
- `/lab/patients/[id]`: results table by date, with a trend chart for any number reported at least twice. The reference band appears when the range has both limits.

The doctor's Unread results list shows a one-line summary with what is out of range first.

## Starter ranges

`lib/catalog/starter-lab.ts` holds typical adult values for 23 tests, as a starting point only. **Each clinic's pathologist must review them against their own analysers and methods before use.** Ranges for children are not included.

Existing clinics get the parameters by choosing **Import** on the Lab tests tab. New clinics get them at onboarding.

## Why it is built this way

Other systems store one row per analyte with its unit and range ([FHIR/LOINC guide](https://docs.snomed.org/implementation-guides/loinc-implementation-guide/information-models-and-terminology-binding/5.3-hl7-fhir-and-laboratory-data/5.3.2-fhir-resources-for-representing-laboratory-results)), group results into panels ([Ontario example](https://transfusionontario.org/wp-content/uploads/2025/10/TipSheet_LabPathologyPortlet_EN.pdf)), do not plot different units on one trend, and warn that ranges differ between labs ([ClinicalConnect](https://info.clinicalconnect.ca/CC/healthcare/resource-centre-lab-views)).

## Not in this version

Direct connection to lab machines (HL7/ASTM), LOINC codes, correcting a saved result (tell the doctor, who records an amendment), saving a half-entered result to finish later, Word or Excel documents, virus scanning of uploads, storage limits per plan. File names outside Latin script show correctly on screen but print as "?" in the PDF, whose standard fonts cannot draw them.
