# Clinic Admin guide

You run the clinic's setup: staff, roles, services, doctors' schedules, the medicine list, messaging and imports. You can read patient records and consultations, but you cannot write or sign clinical notes; that keeps the medical record in the hands of clinicians.

Your **Administration** menu has everything below. You also see the front-desk screens (Today, Queue, Appointments, Patients, Billing). For those, see the [Receptionist guide](receptionist.md).

## First-day setup checklist

Work through these in order when your clinic is new:

1. **Clinic settings:** name, contact details, letterhead and timezone.
2. **Services:** what you charge for (consultation, follow-up, dressing, ...).
3. **Staff:** create an account for everyone. Doctors need their registration number before they can sign.
4. **Schedules:** each doctor's weekly hours and the services they offer.
5. **Medicines & catalogues:** review the starter medicine list; add your own medicines and lab tests.
6. **Messaging** (if your plan includes WhatsApp): connect your WhatsApp Business number.
7. **Import patients** if you are moving from another system.

## Clinic settings

**Clinic settings** has one form with a single **Save settings** button:

- **Identity:** name, phone, email, address, city, website.
- **Letterhead:** **Letterhead lines** and **Footer** appear on prescriptions, invoices and receipts.
- **Operations:** **Timezone**, **Currency** and **Calendar slot length** (5 to 30 minutes).
- **Analytics** (if your plan has it): **Hide counts below** sets how small a group must be before analytics hides it. The minimum is 3; 5 is common.

## Staff

**Staff** lists everyone, with how many are **Awaiting first sign-in** and how many doctors have **No reg. no.**

To add someone:

1. Click **Add staff**.
2. Enter their name and **Email (sign-in)**, and tick their **Roles**. A person can hold several roles.
3. For doctors, fill in **Doctor details**: specialty, **Medical registration number** and **Registration council**. Without a registration number a doctor cannot sign consultations.
4. Click **Create account**, copy the one-time password and give it to them in person or securely. It is shown only once.

Open a staff member to edit their profile and roles (**Save changes**), **Issue new password** if they forget theirs, or **Disable** their account when they leave. Disabling signs them out at once; their past work stays in the record. **Enable** restores access.

## Roles & permissions

Each role starts with sensible defaults: Clinic Admin, Receptionist, Nurse, Doctor, Pharmacist, Lab Technician, Analyst and Auditor. Pick a role on the left and switch individual permissions on or off. Some items are locked as a **Safety rule** (for example, the Analyst role can never see patient records). **Reset to defaults** undoes your changes to a role.

Changes apply immediately to everyone with that role.

## Services

**New service:** name, **Duration (minutes)**, **Price** and an optional description. Untick **Bookable** to hide a service from booking without deleting it.

## Schedules and leave

**Schedules** lists every doctor's working days and hours. Click **Edit** for a doctor:

- **Weekly hours:** **Add hours** for a day, **Add shift** for a split day (for example a morning and evening session). **Mon–Fri** copies a day's hours to every weekday.
- **Services offered:** what patients can book with this doctor.
- Click **Save schedule**.
- **Leave days:** pick the **Day**, add a **Reason** and click **Add leave**. Nobody can book the doctor that day. If patients are already booked, you see **{n} booked: move them**. Reschedule them from **Appointments**.

## Medicines & catalogues

Each tab holds one list your clinic controls:

| Tab | What it is |
| --- | --- |
| Medicines | What doctors can prescribe and the pharmacy sells. Includes default dose, frequency and duration |
| Interactions | Pairs of medicines that warn the doctor, with a severity |
| Allergy classes | Groups such as penicillins, so an allergy warns on every medicine in the class |
| Prescribing presets | Quick-pick dose and frequency combinations |
| Diagnosis codes | Your clinic's favourite ICD-10 codes |
| Vital ranges | What counts as low, high or critical for each vital sign |
| Lab tests | Tests doctors can order, with sample, unit, reference range and price |

When new entries are added to the built-in starter list, a banner offers **Import N new entries**. It only adds; it never changes or removes your own entries. **Deactivate** hides an entry from new prescriptions and orders without affecting past records.

## WhatsApp messaging

You need a WhatsApp Business account with the Cloud API set up in Meta Business Manager.

1. In **Messaging**, under **Connection and reminders**, enter the **Phone number ID**, **WhatsApp business account ID**, **Display number** and **Access token**. The token is stored encrypted and never shown again.
2. Tick **Messaging on**. For reminders, tick **Appointment reminders**, choose how many hours before, and enter your approved **Reminder template** name and **Template language**.
3. Click **Save**, then **Check connection**.
4. Under **Broadcast templates**, **Add template** for each template Meta has approved for broadcasts.

Messages go only to patients who have agreed (see **Messaging consent** on each patient's page). Sending happens in the background; the stats at the top show what was sent, what is waiting and what failed.

To send a broadcast, see **Broadcasts** in the [Receptionist guide](receptionist.md#broadcasts).

## Importing patients

1. Prepare a CSV file with the columns listed under **Columns**. `first_name` and `sex` are required, plus either `date_of_birth` or `age`. Consent columns take yes/no.
2. **Choose a CSV file** (up to 2,000 patients and 2 MB) and click **Check file**.
3. If any row has a problem, NuvaLyf lists every problem and imports nothing. Fix the file and check it again.
4. When every row passes, click **Import N patients**. Either all rows are imported or none are.

## Reports

**Reports** shows collections, outstanding payments and visit volume for the last **7 days**, **30 days** or **90 days**: collections per day and by payment method, outstanding invoices by age, visits per day and by doctor.

## Audit trail

**Audit trail** opens the compliance panel, where you can see who did what and when. See the [Auditor guide](auditor.md).
