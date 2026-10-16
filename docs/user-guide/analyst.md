# Analyst guide

You study the clinic's data without seeing who anyone is. You cannot open patient records, and nothing you see or export contains names, phone numbers or record numbers.

## How privacy is protected

- **Small groups are hidden.** Any count below your clinic's threshold (usually 5) shows as **<5**. Hover over it for the explanation. This stops anyone working out who a rare case is.
- **Ages are in 5-year bands** and dates in **whole months**.
- **Patients in a cohort have pseudonyms**, not names. The same patient gets a different pseudonym in each cohort, so cohorts cannot be joined to identify someone.
- **Every cohort run and export is logged.**

## Overview and data quality

**Analytics** has three tabs:

- **Overview:** visits per month, patients by age and sex, most common diagnoses and most prescribed medicines. A month too small to show appears as a gap, and totals that leave some out say so.
- **Cohorts:** your saved patient groups.
- **Data quality:** how complete records are: patients with age only (no date of birth) or no sex recorded, consultations signed without a diagnosis or vitals, codes outside the clinic's ICD-10 list, and so on. Use it to judge how far to trust an analysis, and to tell the Clinic Admin what to improve.

## Building a cohort

1. **Cohorts → New cohort**.
2. Give it a **Name** and a **Purpose**. Write the purpose clearly; it is recorded with every run and export.
3. Set the criteria: the visit window (**Visited from … to**, whole months), **Diagnosed with** (ICD-10 codes or prefixes, for example `E11` for type 2 diabetes), **Prescribed** (generic names), **Sex**, and an age range in 5-year steps.
4. Click **Create cohort**, then **Run now**.

The **Results** panel shows the cohort's breakdowns, with small cells hidden. **Run history** lists every run.

## Exporting

**Export CSV** downloads the cohort's de-identified rows: pseudonym, age band, sex, number of visits, diagnosis codes and generic medicine names. A header block records the cohort's purpose, definition and version, and how many rows were withheld because their age-and-sex group was too small. A cohort smaller than the threshold cannot be exported.

**Archive** a cohort you no longer need. Its runs and exports remain in the log.
