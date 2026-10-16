# Super Admin and operator guide

The operations console is where you onboard and manage clinics. It is separate from the clinic panel: you sign in at `/platform/login`, and you never see patient records.

There are two console roles:

- **Operator:** onboard clinics, manage plans, suspend and restore clinics.
- **Platform Admin:** everything an operator can do, plus managing operators and rescuing a locked-out clinic administrator.

## Signing in

Open `/platform/login` (**Operator sign-in**), enter your **Email** and **Password** and click **Sign in to console**. Console sessions last one hour from sign-in. Change your password under **My password** (at least 12 characters).

## The estate

**Estate** is your home page. It shows how many **Clinics** exist, how many are **Suspended**, **Active clinic staff** and **Active operators**, and **Recent console activity**. A warning appears when some clinics have no plan.

## Onboarding a clinic

1. Click **Onboard a clinic**.
2. Under **Clinic**, enter the **Clinic name** and a **Clinic code**. Staff type the code when they sign in, so keep it short and memorable (for example `sunrise-clinic`). Choose the **Plan** and **Timezone**, and add the contact details.
3. Under **First administrator**, enter their **First name**, **Last name** and **Email**.
4. Click **Create clinic**.
5. **Clinic created** shows the clinic code, the administrator's email and a one-time password marked **Shown once**. Copy it and send it to the administrator securely (not in the same message as the email address if you can avoid it). Click **I have saved it**.

The administrator must change the password at first sign-in. If the button reads **Onboarding switched off**, the server is not configured for onboarding; ask whoever runs the server.

## Plans and modules

A plan decides which optional modules a clinic gets: **Pharmacy**, **Lab**, **WhatsApp messaging**, **Reports** and **Analytics** (Analytics needs Reports). Patients, appointments, the queue, consultations, prescriptions, billing and the audit trail are always included.

- **Plans → New plan:** enter a name and description, tick the modules, click **Create plan**.
- **Edit** a plan to change its modules. Changes apply to every clinic on that plan straight away. Untick **Available for new assignments** to retire a plan; clinics already on it keep it.
- To change a clinic's plan, open the clinic, choose a **Plan** under **Plan & modules** and click **Save plan**.

## Suspending and restoring a clinic

Open the clinic from **Clinics** and click **Suspend clinic**. Enter a **Reason** and confirm. Everyone at that clinic is signed out immediately and cannot sign in until you **Restore clinic**. No data is deleted.

## Rescuing a clinic administrator (Platform Admin)

If a clinic's only administrator is locked out, open the clinic. Under **Clinic administrators**, click **Rescue** next to their email, then **Issue new password**. Give them the one-time password securely. The rescue is recorded in the console's audit log.

## Operators (Platform Admin)

- **Add operator:** enter the name, email and role, then **Create operator**. Pass on the one-time password.
- **Edit:** change their role, or set the status to **Disabled** to remove access.
- **New password:** issues a fresh one-time password.

You cannot disable yourself or remove the last active Platform Admin.
