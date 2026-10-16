# NuvaLyf UAT checklist (pilot clinic)

User acceptance testing with the pilot clinic, run on the staging server with realistic but **not real** patient data. Each person tests their own role using the [user guide](user-guide/README.md) for it.

**How to use it:** tick each item when it works as described. If it doesn't, write the issue number in the **Notes** column. Retest after fixes. Sign-off needs every **Must** item ticked and no open issue of severity High.

| Severity | Meaning |
| --- | --- |
| High | Wrong clinical or financial data, data visible to the wrong person, or a role cannot do its daily job |
| Medium | Workaround exists, but the task is slow or confusing |
| Low | Cosmetic or wording |

## 0. Before UAT (project team)

| # | Check | Must | ✓ | Notes |
| --- | --- | --- | --- | --- |
| 0.1 | Staging deployed over https; `/api/health` shows `database: ok`, `worker: ok` | ✓ | | |
| 0.2 | Pilot clinic onboarded with the plan it will buy | ✓ | | |
| 0.3 | One account per tester, roles as in real life | ✓ | | |
| 0.4 | Nightly backup running; one restore drill passed on staging | ✓ | | |
| 0.5 | WhatsApp test number connected (or `WHATSAPP_DRIVER=log` agreed) | | | |

## 1. Sign-in and accounts (everyone)

| # | Check | Must | ✓ | Notes |
| --- | --- | --- | --- | --- |
| 1.1 | Sign in with clinic code, email and one-time password; forced to set a new one | ✓ | | |
| 1.2 | Wrong password several times is eventually refused for a while | ✓ | | |
| 1.3 | Menu shows only your role's screens; typing another screen's address shows "Not available for your role" | ✓ | | |
| 1.4 | Admin disables an account: that person is signed out on their next click | ✓ | | |
| 1.5 | Changing your password signs you out on your other devices | | | |

## 2. Clinic Admin setup

| # | Check | Must | ✓ | Notes |
| --- | --- | --- | --- | --- |
| 2.1 | Clinic settings and letterhead saved; letterhead appears on a prescription PDF and invoice PDF | ✓ | | |
| 2.2 | Services created with the clinic's real prices | ✓ | | |
| 2.3 | Staff created; a doctor without a registration number cannot sign | ✓ | | |
| 2.4 | Doctor weekly hours, split shifts and services set; booking offers only those slots | ✓ | | |
| 2.5 | Leave day added; the doctor cannot be booked that day; already-booked patients are flagged | ✓ | | |
| 2.6 | Medicine list reviewed; clinic's own medicines, prices and lab tests added | ✓ | | |
| 2.7 | A permission switched off for a role takes effect immediately | | | |
| 2.8 | Patient CSV import: a file with errors imports nothing and lists the problems; a clean file imports all | | | |

## 3. Front desk (Receptionist)

| # | Check | Must | ✓ | Notes |
| --- | --- | --- | --- | --- |
| 3.1 | Register a patient; searching the same name or mobile again finds the existing record | ✓ | | |
| 3.2 | Registering a likely duplicate asks for a reason | ✓ | | |
| 3.3 | Book, reschedule, cancel (with reason) and mark no-show | ✓ | | |
| 3.4 | Check in a booked patient and add a walk-in; both appear in the queue in the right order | ✓ | | |
| 3.5 | Emergency admission goes to the front of the queue; record completed afterwards | ✓ | | |
| 3.6 | Messaging consent recorded and withdrawn; history shows both | | | |

## 4. Nurse and Doctor

| # | Check | Must | ✓ | Notes |
| --- | --- | --- | --- | --- |
| 4.1 | Nurse triages: vitals saved, abnormal values flagged, BMI shown | ✓ | | |
| 4.2 | Allergy recorded (or "No known allergies") and handed over; patient shows "Ready for doctor" | ✓ | | |
| 4.3 | Doctor's "Call next patient" picks emergencies first, then triaged patients | ✓ | | |
| 4.4 | Notes, diagnosis (ICD-10 search and favourites) and prescription saved | ✓ | | |
| 4.5 | Prescribing a medicine the patient is allergic to warns and requires a reason | ✓ | | |
| 4.6 | Prescribing two interacting medicines warns with the right severity | ✓ | | |
| 4.7 | Sign & finalise; afterwards nothing can be edited; an amendment can be added | ✓ | | |
| 4.8 | Prescription PDF is correct and legible, including the doctor's registration number | ✓ | | |
| 4.9 | A second doctor cannot edit the first doctor's open consultation without "Take over" | | | |
| 4.10 | Private note is not visible to another doctor or the Clinic Admin | | | |

## 5. Lab (if in plan)

| # | Check | Must | ✓ | Notes |
| --- | --- | --- | --- | --- |
| 5.1 | Ordered test appears on the lab worklist within a minute | ✓ | | |
| 5.2 | Result entered; it appears in the doctor's "Unread results" | ✓ | | |
| 5.3 | Critical result is clearly marked | ✓ | | |

## 6. Billing

| # | Check | Must | ✓ | Notes |
| --- | --- | --- | --- | --- |
| 6.1 | Invoice for a visit includes the service and ordered lab tests | ✓ | | |
| 6.2 | Discount needs a reason; totals are correct to the paisa | ✓ | | |
| 6.3 | Part payment, then full payment; status goes Unpaid → Part paid → Paid | ✓ | | |
| 6.4 | Double-clicking "Record payment" records one payment | ✓ | | |
| 6.5 | Issued invoice cannot be edited; refund and void need a reason | ✓ | | |
| 6.6 | Day's collections on Billing match the cash drawer | ✓ | | |

## 7. Pharmacy (if in plan)

| # | Check | Must | ✓ | Notes |
| --- | --- | --- | --- | --- |
| 7.1 | Signed prescription appears in the pharmacy queue | ✓ | | |
| 7.2 | Dispense picks the earliest-expiring batch; expired batches cannot be sold | ✓ | | |
| 7.3 | Cannot dispense more than prescribed; part fill leaves the rest on the queue | ✓ | | |
| 7.4 | Question to the doctor appears on their Today page; reply comes back | | | |
| 7.5 | Over-the-counter sale and receipt PDF | ✓ | | |
| 7.6 | Stock received, adjusted and written off; the ledger explains the on-hand figure | ✓ | | |
| 7.7 | Purchase order: the person who raised it cannot approve it; receiving adds stock | ✓ | | |
| 7.8 | A physical stock count of 10 medicines matches NuvaLyf | ✓ | | |

## 8. Messaging (if in plan)

| # | Check | Must | ✓ | Notes |
| --- | --- | --- | --- | --- |
| 8.1 | "Check connection" succeeds with the clinic's WhatsApp number | ✓ | | |
| 8.2 | Appointment reminder arrives at the configured time for a consenting patient only | ✓ | | |
| 8.3 | Broadcast counts exclude patients without consent or mobile; only consenting patients receive it | ✓ | | |

## 9. Oversight

| # | Check | Must | ✓ | Notes |
| --- | --- | --- | --- | --- |
| 9.1 | Auditor sees who opened a patient record, but no clinical content | ✓ | | |
| 9.2 | Refused access attempts (from 1.3) appear as Critical | ✓ | | |
| 9.3 | Audit CSV export opens in Excel | | | |
| 9.4 | Reports totals match Billing for the same period | ✓ | | |
| 9.5 | Analyst sees no names or record numbers anywhere; small groups show "<5" | ✓ | | |
| 9.6 | Analyst cannot open a patient record by typing its address | ✓ | | |

## 10. Super Admin

| # | Check | Must | ✓ | Notes |
| --- | --- | --- | --- | --- |
| 10.1 | Onboard a second test clinic; its staff cannot see the pilot clinic's patients | ✓ | | |
| 10.2 | Suspend the test clinic: its staff are signed out and cannot sign in; restore works | ✓ | | |
| 10.3 | Rescue a locked-out clinic admin | ✓ | | |
| 10.4 | Console never shows patient names or records | ✓ | | |

## 11. A real day

| # | Check | Must | ✓ | Notes |
| --- | --- | --- | --- | --- |
| 11.1 | Run a full mock clinic session (at least 20 patients, all roles at once) without paper fallback | ✓ | | |
| 11.2 | Screens stay responsive with every workstation open | ✓ | | |
| 11.3 | Works on the clinic's actual devices and printers (desk PCs, tablet, receipt printer) | ✓ | | |
| 11.4 | Staff could do their job after reading only their guide and a short walkthrough | | | |

## Sign-off

| Role | Name | Date | Signature |
| --- | --- | --- | --- |
| Clinic owner / Clinic Admin | | | |
| Lead doctor | | | |
| Front desk lead | | | |
| Project lead | | | |

Open issues accepted at sign-off (Medium/Low only):
