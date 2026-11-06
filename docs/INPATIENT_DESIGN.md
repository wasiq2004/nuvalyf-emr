# Inpatient care

Module `inpatient`, switched on per plan. Code: `features/inpatient`, `lib/db/schema/inpatient.ts`, `app/(clinic)/inpatient`.

## Flow

1. **Setup** (`/settings/inpatient`): bed categories with a price per 24 hours, then beds, then the billing rule and summary sections.
2. **Admit** (from the patient record or `/inpatient`): reason, consultant, free bed, date and time.
3. **During the stay:** nurses and doctors use the normal consultation screen for vitals, notes, diagnoses and lab tests. Reception adds charges and takes payments. Pharmacy charges sales to the stay.
4. **Discharge:** the bed is freed and bed charges stop. Payment may continue afterwards.
5. **Summary:** drafted from the record, edited and signed by the doctor, then locked.

## Design

An admission creates a visit with status `inpatient` and one open consultation. Reusing the consultation means vitals, notes, lab orders and the discharge prescription need no second implementation. The `inpatient` status keeps the stay out of the outpatient queue, and `visitsToBill` excludes any visit with an admission.

Nothing on the bill is stored as a running total. `admissionBill` works it out from stays, charges and payments, so every figure can be traced to a record, and a correction is another record:

| Change | How it is recorded |
|---|---|
| Wrong charge | Struck out with a reason (`voided_at`); it stays visible |
| Bed hours or rate | `override_hours` / `override_rate` on the stay, with a reason and who did it (`inpatient:adjust`) |
| Discount | On the admission, with a reason and who did it |
| Payment | `admission_payments` is append-only; a refund is a new row |

## Bed charges

The clock runs from admission. Stays are kept to the minute, and a part hour counts as a full hour.

| Toggle (Beds & inpatient) | Rule | 30 h at ₹2,400 a day | 26 h at ₹2,400 a day |
|---|---|---|---|
| On: `hourly` | Exact hours at daily rate / 24 | 30 h, ₹3,000 | 26 h, ₹2,600 |
| Off: `block` | Whole 24-hour blocks, rounded up | 48 h, ₹4,800 | 48 h, ₹4,800 |

- A stay is charged at least `minimum_hours` (default 24, clinic setting; 0 turns it off).
- The rule is copied onto the admission, so changing the setting never reprices a stay already running.
- The daily rate is copied onto the bed stay, so a price change does not touch patients already in a bed.
- A patient who changes beds stays on one clock: rounding happens once on the whole stay, so a move never adds a second minimum or block. Hours added by rounding go to the latest bed.

Rules: `features/inpatient/bed-billing-rules.ts`, unit tested.

## Pharmacy and lab on the bill

- A pharmacy sale with method `inpatient` adds a charge for its total. It remains a normal GST invoice with its own number.
- A credit note against such a sale adds a negative charge.
- These are not cash: reports exclude method `inpatient` from pharmacy collections.
- Payments on a stay count in clinic collections.
- A lab order on the stay's consultation adds a charge at the test's price, if it has one. Cancelling the order strikes it out.

## Discharge summary

Sections and order come from the clinic's settings: nine standard sections plus any of its own. A standard section is filled from the record; "Fill empty sections" never overwrites what the doctor wrote.

"Condition at discharge" must be written by the doctor before signing. Signing needs `discharge:sign` and a registration number. A database trigger then refuses any change, including by the table owner.

The summary shows the bill, paid amount and balance. It is never held back for payment.

## Permissions

| Permission | Default roles | Covers |
|---|---|---|
| `inpatient:read` | Clinic Admin, Receptionist, Nurse, Doctor | Bed board, admissions, draft summary |
| `inpatient:admit` | Clinic Admin, Receptionist, Nurse, Doctor | Admit, change bed, discharge |
| `inpatient:bill` | Clinic Admin, Receptionist | Charges, payments |
| `inpatient:adjust` | Clinic Admin | Bed hours and rate, discounts, striking out charges |
| `discharge:sign` | Doctor | Edit and sign the summary |

## Not in this version

Ward medicine chart, surgery and OT notes, insurance claims, GST on hospital services. Medicines given on the ward reach the bill through pharmacy sales.
