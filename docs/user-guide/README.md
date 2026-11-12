# NuvaLyf user guide

Pick the guide for your role. If you hold more than one role (for example Clinic Admin and Doctor), read each; your menu shows everything your roles allow.

| Role | Guide | You will mostly use |
| --- | --- | --- |
| Super Admin / operator | [super-admin.md](super-admin.md) | The operations console: onboarding clinics, plans, suspensions |
| Clinic Admin | [clinic-admin.md](clinic-admin.md) | Staff, roles, services, schedules, medicines, messaging, reports |
| Receptionist | [receptionist.md](receptionist.md) | Patients, appointments, queue, billing |
| Nurse | [nurse.md](nurse.md) | Triage: vitals, allergies, notes, hand over |
| Doctor | [doctor.md](doctor.md) | Consultations, prescriptions, lab orders, signing |
| Lab Technician | [lab-technician.md](lab-technician.md) | The lab worklist |
| Pharmacist | [pharmacist.md](pharmacist.md) | Dispensing, sales, stock, purchase orders |
| Analyst | [analyst.md](analyst.md) | De-identified analytics and cohorts |
| Auditor | [auditor.md](auditor.md) | The audit trail |

## For everyone

### Signing in

1. Go to your clinic's NuvaLyf address and open **Sign in**.
2. Enter the **Clinic code** your administrator gave you (for example `sunrise-clinic`), your **Email** and **Password**, then **Sign in**.
3. The first time, you sign in with a one-time password. NuvaLyf asks you to **Choose a new password**. The one-time password counts as your **Current password**. Your new password must be at least 10 characters.

Forgot your password? Ask your Clinic Admin. They can issue a new one-time password.

### Two-step sign-in

With two-step sign-in on, signing in also needs the 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or similar). Someone who learns your password still cannot get in.

- **Clinic Admins must use it.** After your first password change, NuvaLyf asks you to set it up before anything else opens. Anyone else can turn it on under **My account > Two-step sign-in**.
- **Setting up:** click **Set up two-step sign-in**. In your app, add an account, choose "Enter a setup key" and type the key shown. On your phone, **Open it in the authenticator app** does this for you. Then enter the code the app shows.
- **Recovery codes:** ten codes appear once. Save them away from your phone. Each one signs you in once if the phone is lost.
- **Signing in:** after your password, enter the newest code from the app. A code works once: if it is refused, wait for the next one.
- **Lost your phone?** Use a recovery code, or ask your Clinic Admin to **Reset** two-step sign-in. You then set it up again.

You are signed out automatically 8 hours after signing in, even if you are active, so sign in at the start of each shift. You are also signed out if your password or access changes.

### Finding your way

- The menu on the left shows only what your role can use. **Collapse** makes it narrow; **Sign out** is at the bottom.
- The sun/moon button at the top switches between light and dark mode.
- **My account** shows your name, clinic, roles and (for doctors) your registration number. **Change password** there signs you out everywhere else.
- If you open a page your role cannot use, you see **Not available for your role** and a button back to your home page.
- Queue, Today, Lab and Pharmacy screens refresh themselves every 30 to 60 seconds while they are open. You do not need to reload.

### Emergencies

Staff who can admit emergencies see a red **Emergency** button at the top of every screen.

1. Click **Emergency**.
2. Enter a **Description** (for example "Unknown male, approx 40, road accident"). Add **Sex**, **Approx. age** and the **Phone of person who brought them** if known.
3. Click **Admit to front of queue**.

The patient gets a record number and goes straight to the top of the queue, marked **Emergency**. Reception completes the record later (**Complete record** on the patient's page or on Today).
