# Filling a prescription differently

Client decision (2026-11-06): the pharmacist decides what is given, with no doctor approval. For example, a patient prescribed 30 days may buy 15 now and the rest later. Prescribed and billed can differ.

## Rules

- **The doctor's signed prescription never changes.** Each sale line holds the pharmacy's own copy: dose, frequency, days and instructions as dispensed.
- A line is recorded as `as_prescribed`, `changed`, `substituted` or `added`. A line filled differently keeps the text the doctor wrote.
- Selling fewer units leaves the prescription **Part filled**, with the rest open for a later visit. Changing the days works the quantity out again.
- The pharmacist can go above the course (a whole strip), swap to any medicine, remove one or add one.
- The limit is stock on hand: a sale can never take more than the batch holds.
- A medicine the doctor did not write is still checked against the patient's allergies and other medicines. A serious warning must be acknowledged before dispensing. It is not a doctor approval.
- The doctor sees what was given on the consultation, under **Given by the pharmacy**, and the invoice prints how to take each medicine.

Finding a patient: `/pharmacy?q=` searches name, phone or record number and shows their prescriptions at any age, unlike the queue, which shows the last 30 days.

## Risk the clinic has accepted

This removes an earlier control that blocked dispensing above the prescribed course (`SECURITY.md`, finding 7). Nothing now limits the quantity of a Schedule H1 or X medicine except stock. Every change is recorded and the Schedule register shows the quantities, so this is detectable, not prevented. The clinic should confirm this matches its licence conditions and the Drugs Rules with its responsible pharmacist.
