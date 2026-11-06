# Lab reports

Every test reports its own list of parameters. A CBC has haemoglobin, platelets, the differential count and so on; urine routine has physical, chemical and microscopy findings. Code: `features/clinical/lab.service.ts`, `features/clinical/lab-rules.ts`, `lib/catalog/starter-lab.ts`.

## Data

| Table | Holds |
|---|---|
| `lab_test_parameters` | One row per parameter: name, report heading, unit, number or word, expected word |
| `lab_parameter_ranges` | Low, high and critical limits by sex and age band |
| `lab_results` | One row per reported value (append-only) |

Each clinic has its own copy. Clinics edit them under Medicines & catalogues > Lab tests. A test with no parameters still takes a single free-text result, and results saved before parameters existed are shown as they were.

## Rules

- **Range:** a sex-specific range beats one for everyone; among those, the narrowest age band that fits wins. With no known age, only an all-ages range applies.
- **Flags** are decided on the server when the result is saved: normal, low, high, critical low, critical high. A word that differs from the expected word is abnormal.
- **Reports never change.** The name, unit, range text and flag are copied onto each result, so editing a range later does not alter an old report.
- **Units:** a parameter reported in a different unit gets its own row and its own trend line. Unlike values are never compared.

## Outputs

- `/lab/report/[encounterId]`: the printable report for a consultation. Out-of-range values are bold and marked L, H, LL, HH or *.
- `/lab/patients/[id]`: results table by date, with a trend chart for any number reported at least twice. The reference band appears when the range has both limits.

The doctor's Unread results list shows a one-line summary with what is out of range first.

## Starter ranges

`lib/catalog/starter-lab.ts` holds typical adult values for 23 tests, as a starting point only. **Each clinic's pathologist must review them against their own analysers and methods before use.** Ranges for children are not included.

Existing clinics get the parameters by choosing **Import** on the Lab tests tab. New clinics get them at onboarding.

## Why it is built this way

Other systems store one row per analyte with its unit and range ([FHIR/LOINC guide](https://docs.snomed.org/implementation-guides/loinc-implementation-guide/information-models-and-terminology-binding/5.3-hl7-fhir-and-laboratory-data/5.3.2-fhir-resources-for-representing-laboratory-results)), group results into panels ([Ontario example](https://transfusionontario.org/wp-content/uploads/2025/10/TipSheet_LabPathologyPortlet_EN.pdf)), do not plot different units on one trend, and warn that ranges differ between labs ([ClinicalConnect](https://info.clinicalconnect.ca/CC/healthcare/resource-centre-lab-views)).

## Not in this version

Direct connection to lab machines (HL7/ASTM), LOINC codes, correcting a saved result (tell the doctor, who records an amendment).
