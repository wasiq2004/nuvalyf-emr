// One clinic day, end to end: onboarding -> admin set-up -> front desk ->
// nurse triage -> doctor consultation -> lab.
import { execSync } from "child_process";
import { expect, test, type Page } from "@playwright/test";
import { clinicFirstSignIn, operatorSignIn, readOneTimePassword } from "./helpers";

test.describe.configure({ mode: "serial" });

const suffix = Date.now().toString(36).slice(-6);
const clinicCode = `e2e-${suffix}`;
const accounts = {
  admin: { email: `admin@${clinicCode}.test`, password: "Lotus-Garden-2026", otp: "" },
  doctor: { email: `doctor@${clinicCode}.test`, password: "River-Stone-2026", otp: "" },
  desk: { email: `desk@${clinicCode}.test`, password: "Maple-Window-2026", otp: "" },
  nurse: { email: `nurse@${clinicCode}.test`, password: "Coral-Bridge-2026", otp: "" },
  lab: { email: `lab@${clinicCode}.test`, password: "Amber-Field-2026", otp: "" },
  pharm: { email: `pharm@${clinicCode}.test`, password: "Cedar-Lamp-2026", otp: "" },
  auditor: { email: `auditor@${clinicCode}.test`, password: "Quartz-Harbor-2026", otp: "" },
  analyst: { email: `analyst@${clinicCode}.test`, password: "Willow-Prism-2026", otp: "" },
};
const patientName = `Anika Verma${suffix}`;

let adminPage: Page;
let deskPage: Page;
let nursePage: Page;
let doctorPage: Page;
let labPage: Page;
let pharmPage: Page;
let auditorPage: Page;
let analystPage: Page;
let encounterUrl = "";

test.beforeAll(async ({ browser }) => {
  adminPage = await (await browser.newContext()).newPage();
  deskPage = await (await browser.newContext()).newPage();
  nursePage = await (await browser.newContext()).newPage();
  doctorPage = await (await browser.newContext()).newPage();
  labPage = await (await browser.newContext()).newPage();
  pharmPage = await (await browser.newContext()).newPage();
  auditorPage = await (await browser.newContext()).newPage();
  analystPage = await (await browser.newContext()).newPage();
});

test("Super Admin onboards a clinic", async ({ page }) => {
  await operatorSignIn(page);

  // A plan with every module, so the clinic gets the lab.
  await page.goto("/platform/plans");
  await page.getByRole("button", { name: "New plan" }).click();
  await page.getByLabel("Name").fill(`E2E Full ${suffix}`);
  for (const key of ["pharmacy", "lab", "whatsapp", "reports", "analytics"]) {
    await page.locator(`input[name="modules[]"][value="${key}"]`).check();
  }
  await page.getByRole("button", { name: "Create plan" }).click();
  await expect(page.getByText("Plan created")).toBeVisible();

  await page.goto("/platform/tenants?onboard=1");
  await page.getByLabel("Clinic name").fill(`E2E Clinic ${suffix}`);
  await page.getByLabel("Clinic code").fill(clinicCode);
  await page.locator('select[name="planId"]').selectOption({ label: `E2E Full ${suffix}` });
  await page.getByLabel("First name").fill("Ira");
  await page.getByLabel("Last name").fill("Admin");
  await page.locator('input[name="adminEmail"]').fill(accounts.admin.email);
  await page.getByRole("button", { name: "Create clinic" }).click();
  accounts.admin.otp = await readOneTimePassword(page);
  await page.waitForURL(/\/platform\/tenants\/[0-9a-f-]+$/);
  await expect(page.getByText(accounts.admin.email)).toBeVisible();
});

test("Clinic Admin sets up services, staff and a schedule", async () => {
  const page = adminPage;
  await clinicFirstSignIn(page, clinicCode, accounts.admin.email, accounts.admin.otp, accounts.admin.password);

  await page.goto("/settings/services");
  await page.getByRole("button", { name: "New service" }).click();
  await page.getByLabel("Name").fill("General consultation");
  await page.getByLabel("Duration (minutes)").fill("15");
  await page.getByLabel(/Price/).fill("500");
  await page.getByRole("button", { name: "Create service" }).click();
  await expect(page.getByRole("cell", { name: "General consultation" })).toBeVisible();

  await page.goto("/settings/users");
  for (const [key, role, first] of [
    ["doctor", "doctor", "Dev"],
    ["desk", "receptionist", "Diya"],
    ["nurse", "nurse", "Neha"],
    ["lab", "lab_tech", "Lalit"],
    ["pharm", "pharmacist", "Pia"],
    ["auditor", "auditor", "Avi"],
    ["analyst", "analyst", "Ana"],
  ] as const) {
    await page.getByRole("button", { name: "Add staff" }).click();
    await page.getByLabel("First name").fill(first);
    await page.getByLabel("Last name").fill("Test");
    await page.getByLabel("Email (sign-in)").fill(accounts[key].email);
    await page.locator(`input[value="${role}"]`).check();
    if (role === "doctor") await page.getByLabel("Medical registration number").fill("KMC-2026-0042");
    await page.getByRole("button", { name: "Create account" }).click();
    accounts[key].otp = await readOneTimePassword(page);
  }

  await page.goto("/settings/schedules");
  await page.getByRole("link", { name: "Edit" }).first().click();
  // Every day 08:00-22:00 so the test can book whatever day it runs.
  for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
    const row = page.locator("div.rounded-2xl", { has: page.getByText(day, { exact: true }) }).first();
    await row.getByRole("button", { name: "Add hours" }).click();
    await row.getByLabel(`${day} start`).fill("08:00");
    await row.getByLabel(`${day} end`).fill("22:00");
  }
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByText("Schedule saved")).toBeVisible();
});

test("Receptionist cannot reach administration", async () => {
  const page = deskPage;
  await clinicFirstSignIn(page, clinicCode, accounts.desk.email, accounts.desk.otp, accounts.desk.password);
  await expect(page.getByRole("navigation", { name: "Main" }).getByText("Staff")).toHaveCount(0);
  const response = await page.goto("/settings/users");
  expect(response?.status()).toBe(403);
});

test("Registration requires a duplicate search, and a reason to override a likely duplicate", async () => {
  const page = deskPage;
  await page.goto("/patients/new");
  const registerButton = page.getByRole("button", { name: "Register patient" });
  await expect(registerButton).toBeDisabled();

  await page.getByLabel("First name").fill("Anika");
  await page.getByLabel("Last name").fill(`Verma${suffix}`);
  await page.getByLabel("Mobile").fill("+91 98450 77777");
  await page.getByLabel("or age (years)").fill("29");
  await page.getByRole("button", { name: "Search for existing patients" }).click();
  await expect(page.getByText("No matches. Safe to register.")).toBeVisible();

  // Editing details after the search locks registration again.
  await page.getByLabel("or age (years)").fill("30");
  await expect(registerButton).toBeDisabled();
  await page.getByRole("button", { name: "Search for existing patients" }).click();
  await page.locator('select[name="sex"]').selectOption("female");
  await registerButton.click();
  await page.waitForURL(/\/patients\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: patientName })).toBeVisible();

  // Same person again: flagged, needs a reason.
  await page.goto("/patients/new");
  await page.getByLabel("First name").fill("Anika");
  await page.getByLabel("Last name").fill(`Verma${suffix}`);
  await page.getByLabel("Mobile").fill("09845077777");
  await page.getByLabel("or age (years)").fill("30");
  await page.getByRole("button", { name: "Search for existing patients" }).click();
  await expect(page.getByText("Likely the same person")).toBeVisible();
  await page.locator('select[name="sex"]').selectOption("female");
  await page.getByRole("button", { name: "Register patient" }).click();
  await expect(page.getByText("Explain in a sentence")).toBeVisible();
});

test("Book an appointment and check the patient in", async () => {
  const page = deskPage;
  await page.goto("/patients");
  await page.getByRole("searchbox", { name: "Search patients" }).fill(`Verma${suffix}`);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("link", { name: patientName }).click();
  await page.getByRole("link", { name: "Book appointment" }).click();

  // The clinic was onboarded with the default timezone.
  await expect(page.getByText("clinic time (Asia/Kolkata)")).toBeVisible();
  const firstSlot = page.locator("button[aria-pressed]").first();
  await expect(firstSlot).toBeVisible();
  const time = (await firstSlot.innerText()).trim();
  await firstSlot.click();
  await page.getByRole("button", { name: `Book ${time}` }).click();
  await page.waitForURL(/\/appointments\?date=/);
  await expect(page.getByText(patientName)).toBeVisible();

  await page.getByRole("button", { name: "Check in" }).first().click();
  await expect(page.getByText("wait clock started")).toBeVisible();
  await page.goto("/queue");
  await expect(page.getByRole("link", { name: patientName })).toBeVisible();
});

test("An emergency goes to the front of the queue and leaves an urgent task", async () => {
  const page = deskPage;
  await page.goto("/queue");
  await page.getByRole("button", { name: "Emergency" }).click();
  await page.getByLabel("Description").fill(`Unknown male ${suffix}, approx 40`);
  await page.getByLabel("Phone of person who brought them").fill("9811100000");
  await page.getByRole("button", { name: "Admit to front of queue" }).click();
  await expect(page.getByText(/Emergency admitted as P-/)).toBeVisible();

  await page.reload();
  const first = page.locator("ol > li").first();
  await expect(first).toContainText(`Unknown male ${suffix}`);
  await expect(first).toContainText("Brought in by 9811100000");

  await page.goto("/today");
  await expect(page.getByText(`Complete the record for emergency patient "Unknown male ${suffix}, approx 40"`)).toBeVisible();
});

test("Nurse triages: flagged vitals, an allergy, then hands over", async () => {
  const page = nursePage;
  await clinicFirstSignIn(page, clinicCode, accounts.nurse.email, accounts.nurse.otp, accounts.nurse.password);
  await expect(page.getByRole("heading", { name: "Triage" })).toBeVisible();
  await page.getByRole("button", { name: `Start triage for ${patientName}` }).click();
  await page.waitForURL(/\/encounters\/[0-9a-f-]+$/);
  encounterUrl = page.url();
  await expect(page.getByLabel("Allergies")).toContainText("Allergies not recorded yet");

  await page.getByRole("button", { name: "Record vitals" }).click();
  await page.getByLabel("Temperature (°C)").fill("38.6");
  await page.getByLabel("Pulse (/min)").fill("88");
  await page.getByLabel("Systolic BP (mmHg)").fill("150");
  await page.getByLabel("Diastolic BP (mmHg)").fill("92");
  await page.getByRole("button", { name: "Save vitals" }).click();
  await expect(page.getByText(/Vitals recorded\. Flagged: Temperature high/)).toBeVisible();

  await page.getByRole("button", { name: "Add allergy" }).click();
  await page.getByLabel("Substance").fill("Penicillin");
  await page.getByLabel("Medicine class").selectOption({ label: "Penicillins" });
  await page.getByLabel("Severity").selectOption("severe");
  await page.getByRole("button", { name: "Record allergy" }).click();
  await expect(page.getByLabel("Allergies").first()).toContainText("Penicillin");

  await page.getByRole("button", { name: "Ready for doctor" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Hand over" }).click();
  await expect(page.getByText("Patient is ready for the doctor")).toBeVisible();
});

test("Doctor is warned about the allergy, prescribes, orders a test and signs", async () => {
  const page = doctorPage;
  await clinicFirstSignIn(page, clinicCode, accounts.doctor.email, accounts.doctor.otp, accounts.doctor.password);
  await expect(page.getByRole("heading", { name: "Your queue" })).toBeVisible();
  await page.getByRole("button", { name: `Call ${patientName}` }).click();
  await page.waitForURL(encounterUrl);
  await expect(page.getByLabel("Allergies").first()).toContainText("Penicillin");

  await page.getByLabel("Chief complaint").fill("Sore throat and fever for two days");
  await page.getByRole("button", { name: "Save notes" }).click();
  await expect(page.getByText("Notes saved")).toBeVisible();

  await page.getByRole("searchbox", { name: "Search diagnoses" }).fill("J02");
  await page.getByRole("button", { name: /J02\.9/ }).click();
  await expect(page.getByText("Primary", { exact: true })).toBeVisible();

  // The allergy check fires as soon as the medicine is chosen.
  await page.getByRole("searchbox", { name: "Search medicines" }).fill("Clavulan");
  await page.getByRole("button", { name: /Amoxicillin \+ Clavulanate 625/ }).click();
  await expect(page.getByText("Recorded allergy: Penicillin (severe).")).toBeVisible();
  await expect(page.getByLabel("Reason to prescribe despite the warning")).toBeVisible();
  await page.getByRole("button", { name: "Choose another medicine" }).click();

  await page.getByRole("searchbox", { name: "Search medicines" }).fill("Paracetamol 650");
  await page.getByRole("button", { name: /Paracetamol 650/ }).click();
  await expect(page.getByText("No allergy or interaction found")).toBeVisible();
  await page.getByRole("button", { name: "Add to prescription" }).click();
  await expect(page.getByText("1. Paracetamol 650")).toBeVisible();

  await page.locator('select[name="testId"]').selectOption({ label: "Haemoglobin · Blood (EDTA)" });
  await page.getByRole("button", { name: "Order", exact: true }).click();
  await expect(page.getByText("Awaiting result")).toBeVisible();

  await page.getByRole("button", { name: "Sign & finalise" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Sign & finalise" }).click();
  await expect(page.getByText("Consultation signed")).toBeVisible();
  await expect(page.getByText(/This record can no longer be changed/)).toBeVisible();
  await expect(page.getByLabel("Chief complaint")).toHaveCount(0);

  const pdf = await page.request.get(`${encounterUrl}/prescription`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
});

test("Lab technician enters the result; it waits on the doctor's screen until read", async () => {
  const page = labPage;
  await clinicFirstSignIn(page, clinicCode, accounts.lab.email, accounts.lab.otp, accounts.lab.password, "**/lab");
  await expect(page.getByRole("cell", { name: "Haemoglobin" })).toBeVisible();
  await page.getByRole("button", { name: "Enter result" }).click();
  await page.getByLabel(/^Result/).fill("10.2");
  await page.getByLabel("Interpretation").selectOption("abnormal");
  await page.getByRole("button", { name: "Save result" }).click();
  await expect(page.getByText("Result sent to the doctor")).toBeVisible();

  await doctorPage.goto("/today");
  const unread = doctorPage.locator("section", { has: doctorPage.getByRole("heading", { name: "Unread results" }) });
  await expect(unread).toContainText("Haemoglobin");
  await expect(unread).toContainText("10.2");
  await unread.getByRole("button", { name: "Mark read" }).click();
  await expect(unread).toContainText("Nothing new");
});

test("Clinic Admin edits the medicine list, and reads consultations without writing them", async () => {
  const page = adminPage;
  await page.goto("/settings/catalog");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByLabel("Name (as prescribed)").fill(`Zinc ${suffix}`);
  await page.getByLabel(/^Generic name/).fill("Zinc sulphate");
  await page.getByLabel("Strength / size").fill("20 mg");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Item added")).toBeVisible();
  await expect(page.getByText(`Zinc ${suffix}`)).toBeVisible();

  await page.goto(encounterUrl);
  await expect(page.getByText("Sore throat and fever for two days")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Private note" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add amendment" })).toHaveCount(0);
});

test("Receptionist bills the finished visit; a double-click records one payment", async () => {
  const page = deskPage;
  await page.goto("/billing");
  await page.getByRole("button", { name: `Bill ${patientName}` }).click();
  await page.waitForURL(/\/billing\/[0-9a-f-]+$/);
  await expect(page.getByRole("cell", { name: /^General consultation/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /^Haemoglobin/ })).toBeVisible();

  await page.getByRole("button", { name: "Take payment" }).click();
  await page.getByLabel("Paid by").selectOption("upi");
  await page.getByLabel("Reference").fill(`UPI-${suffix}`);
  await page.getByRole("button", { name: "Record payment" }).dblclick();
  await expect(page.getByText("Payment recorded").first()).toBeVisible();
  // The status badge (the totals list also has a "Paid" row).
  await expect(page.locator("span").filter({ hasText: /^Paid$/ })).toBeVisible();

  const payments = page.locator("section", { has: page.getByRole("heading", { name: "Payments" }) }).locator("li");
  await expect(payments).toHaveCount(1);
  await expect(payments.first()).toContainText(`UPI-${suffix}`);

  const pdf = await page.request.get(`${page.url()}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
});

test("Pharmacist stocks the shelf, fills the prescription once, and sells over the counter", async () => {
  const page = pharmPage;
  await clinicFirstSignIn(page, clinicCode, accounts.pharm.email, accounts.pharm.otp, accounts.pharm.password, "**/pharmacy");

  // A selling price for the medicine (the clinic's own list).
  await page.goto("/settings/catalog?tab=medicines&q=Paracetamol+650");
  await page.locator("tr", { hasText: "Paracetamol 650" }).first().locator("button").first().click();
  await page.getByLabel("Price per unit").fill("2.50");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Item updated")).toBeVisible();

  // Opening stock.
  const expiry = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  await page.goto("/pharmacy/stock");
  await page.getByRole("link", { name: /^Paracetamol 650/ }).click();
  await page.getByRole("button", { name: "Add stock" }).click();
  await page.getByLabel("Batch number").fill(`E2E-${suffix}`);
  await page.getByLabel("Expiry").fill(expiry);
  await page.getByLabel("Quantity (units)").fill("100");
  await page.getByRole("button", { name: "Add stock" }).last().click();
  await expect(page.getByText("Stock added")).toBeVisible();

  // Fill the doctor's prescription: allergies shown, quantity from the course, one sale even on a double-click.
  await page.goto("/pharmacy");
  await page.locator("tr", { hasText: patientName }).getByRole("link", { name: "Fill" }).click();
  await expect(page.getByLabel("Allergies")).toContainText("Penicillin");
  await expect(page.getByLabel("Quantity of Paracetamol 650")).toHaveValue("9");
  await page.getByRole("button", { name: /Dispense & take/ }).dblclick();
  await page.waitForURL(/\/pharmacy\/sales\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "₹22.50" })).toBeVisible();

  await page.goto("/pharmacy");
  await expect(page.locator("tr", { hasText: patientName })).toHaveCount(0);
  const sales = page.locator("section", { has: page.getByRole("heading", { name: "Today's sales" }) }).locator("li");
  await expect(sales).toHaveCount(1);

  // Over the counter.
  await page.getByRole("link", { name: "New sale" }).click();
  await page.getByRole("searchbox", { name: "Search stock" }).fill("Paracetamol 650");
  await page.getByRole("button", { name: /Paracetamol 650/ }).click();
  await page.getByLabel("Quantity of Paracetamol 650").fill("2");
  await page.getByRole("button", { name: "Complete sale" }).click();
  await page.waitForURL(/\/pharmacy\/sales\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "₹5.00" })).toBeVisible();

  await page.goto("/pharmacy/stock");
  await expect(page.locator("tr", { hasText: "Paracetamol 650" }).first()).toContainText("89");
});

test("Pharmacist types in supplier bills: a new consumable, another supplier's spelling remembered, opening stock imported", async () => {
  const page = pharmPage;
  const asha = `Asha Distributors ${suffix}`;
  const bharat = `Bharat Surgicals ${suffix}`;
  const needle = `Clinic needle ${suffix}`;
  const respelt = `Needle clinic ${suffix}`;

  await page.goto("/pharmacy/purchases");
  for (const name of [asha, bharat]) {
    await page.getByRole("button", { name: "Add supplier" }).click();
    await page.getByLabel("Name").fill(name);
    await page.getByRole("button", { name: "Add supplier" }).last().click();
    await expect(page.getByText(name)).toBeVisible();
  }

  // Bill 1: a needle the clinic has never stocked, added from the bill itself.
  await page.getByRole("link", { name: "Enter a supplier bill" }).click();
  await page.getByLabel("Supplier").selectOption({ label: asha });
  await page.getByLabel("Bill number").fill(`A-${suffix}`);
  await page.getByLabel("Item, line 1").fill(needle);
  await page.getByRole("button", { name: `Add “${needle}” as a new item` }).click();
  const dialog = page.getByRole("dialog", { name: "Add a new item" });
  await dialog.getByLabel("Type").selectOption("consumable");
  await dialog.getByLabel("Units per pack").fill("100");
  await dialog.getByRole("button", { name: "Add item" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByLabel("Batch, line 1").fill("ND1");
  await page.getByLabel("Expiry, line 1").fill("12/30");
  await page.getByLabel("Quantity, line 1").fill("2");
  await expect(page.getByLabel("Units per pack, line 1")).toHaveValue("100");
  await page.getByLabel("Rate, line 1").fill("120");
  await page.getByLabel("GST, line 1").selectOption("18");

  // Line 2: an existing medicine, in strips of 15, priced from its MRP.
  await page.getByRole("button", { name: "Add line" }).click();
  await page.getByLabel("Item, line 2").fill("Paracetamol 650");
  await page.getByRole("option", { name: /^Paracetamol 650/ }).click();
  await page.getByLabel("Batch, line 2").fill("PB1");
  await page.getByLabel("Expiry, line 2").fill("06/29");
  await page.getByLabel("Quantity, line 2").fill("5");
  await page.getByLabel("Units per pack, line 2").fill("15");
  await page.getByLabel("Rate, line 2").fill("30");
  await page.getByLabel("MRP, line 2").fill("45");
  // 2 x 120 + 18% GST, and 5 x 30 + 12% GST.
  await expect(page.getByText("₹451.20", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save bill & add to stock" }).dblclick();
  await page.waitForURL(/\/pharmacy\/purchases\/bills\/[0-9a-f-]+$/);
  await expect(page.getByText("2 lines · 275 units added to stock")).toBeVisible();

  // Bill 2: another supplier writes the same needle differently; it is found and the spelling remembered.
  await page.goto("/pharmacy/purchases/bills/new");
  await page.getByLabel("Supplier").selectOption({ label: bharat });
  await page.getByLabel("Bill number").fill(`B-${suffix}`);
  await page.getByLabel("Item, line 1").fill(respelt);
  await page.getByRole("option", { name: new RegExp(`^${needle}`) }).click();
  await expect(page.getByLabel(`Remember “${respelt}” as another name for ${needle}`)).toBeChecked();
  await page.getByLabel("Batch, line 1").fill("ND2");
  await page.getByLabel("Expiry, line 1").fill("12/31");
  await page.getByLabel("Quantity, line 1").fill("1");
  await page.getByLabel("Rate, line 1").fill("118");
  await page.getByRole("button", { name: "Save bill & add to stock" }).click();
  await expect(page.getByText(`Remembered: ${respelt} → ${needle}`)).toBeVisible();
  await page.waitForURL(/\/pharmacy\/purchases\/bills\/[0-9a-f-]+$/);
  await expect(page.getByText(`On the bill: “${respelt}”`)).toBeVisible();

  // Next time that spelling is matched by name.
  await page.goto("/pharmacy/purchases/bills/new");
  await page.getByLabel("Item, line 1").fill(respelt);
  await expect(page.getByRole("option", { name: new RegExp(`Known as “${respelt}”`) })).toBeVisible();

  await page.goto("/pharmacy/stock");
  const row = page.locator("tr", { hasText: needle });
  await expect(row).toContainText("Consumable");
  await expect(row).toContainText("300");

  // Opening stock from the old software's export: checked first, then all in.
  await page.getByRole("link", { name: "Import items & stock" }).click();
  await page.getByLabel("CSV file").setInputFiles({
    name: "opening.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`name,type,batch_no,expiry_date,quantity\nCotton roll ${suffix},consumable,CR1,12/2030,40\n${respelt},,ND3,12/2031,25\n`),
  });
  await page.getByRole("button", { name: "Check file" }).click();
  await expect(page.getByText("All 2 rows are valid: 1 new item, 1 already in your list")).toBeVisible();
  await page.getByRole("button", { name: "Import 2 rows" }).click();
  await expect(page.getByText("Imported: 1 new items, 2 batches, 65 units")).toBeVisible();
  await page.goto("/pharmacy/stock");
  await expect(page.locator("tr", { hasText: `Cotton roll ${suffix}` })).toContainText("40");
  await expect(page.locator("tr", { hasText: needle })).toContainText("325");

  // Sold by the strip, at the strip's MRP from the bill (₹45 for 15), or loose.
  await page.goto("/pharmacy/sale");
  await page.getByRole("searchbox", { name: "Search stock" }).fill("Paracetamol 650");
  await page.getByRole("button", { name: /Paracetamol 650/ }).click();
  await page.getByLabel("Sell Paracetamol 650 as").selectOption("pack");
  await page.getByLabel("Quantity of Paracetamol 650").fill("1");
  await expect(page.getByText("₹45.00 per strip · 15 tablets")).toBeVisible();
  await page.getByRole("button", { name: "Complete sale" }).click();
  await page.waitForURL(/\/pharmacy\/sales\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "₹45.00" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "1 strip (15 tablets)" })).toBeVisible();
});

test("Auditor sees who opened a record, and cannot reach any patient screen", async () => {
  const page = auditorPage;
  await clinicFirstSignIn(page, clinicCode, accounts.auditor.email, accounts.auditor.otp, accounts.auditor.password, "**/audit");
  await expect(page.getByRole("heading", { name: "Audit trail" })).toBeVisible();

  await page.getByRole("link", { name: "Record access" }).click();
  await page.waitForURL("**/audit/access");
  await page.getByLabel("Patient record no.").fill("P-000001");
  await page.getByRole("button", { name: "Look up" }).click();
  const people = page.locator("section", { has: page.getByRole("heading", { name: "By person" }) });
  await expect(people).toContainText("Diya Test"); // receptionist opened the record
  await expect(people).toContainText("Dev Test"); // the doctor opened the consultation
  await expect(people).toContainText("Receptionist");

  // Clinical details are withheld even here.
  await page.goto("/audit?action=PRESCRIPTION_ITEM_ADDED");
  await expect(page.getByText("Clinical details withheld").first()).toBeVisible();
  await expect(page.getByText("Paracetamol 650")).toHaveCount(0);

  const csv = await page.request.get("/audit/export?outcome=denied");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");

  for (const path of ["/patients", "/queue", "/billing", "/pharmacy", "/reports", new URL(encounterUrl).pathname]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(403);
  }
  const pdf = await page.request.get(`${encounterUrl}/prescription`);
  expect(pdf.status()).toBe(403);
});

test("Clinic Admin sees reports", async () => {
  const page = adminPage;
  await page.goto("/reports");
  await expect(page.getByText("Collected", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Collections per day" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "UPI" })).toBeVisible();
});

test("A leave day blocks the doctor's slots, flags existing bookings, and the patient is rescheduled", async () => {
  // Days ahead in the clinic's timezone (onboarded as Asia/Kolkata).
  const clinicDay = (offset: number) => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const leaveDay = clinicDay(2);
  const newDay = clinicDay(3);

  // Front desk books the patient on what will become a leave day.
  const desk = deskPage;
  await desk.goto("/patients");
  await desk.getByRole("searchbox", { name: "Search patients" }).fill(`Verma${suffix}`);
  await desk.getByRole("button", { name: "Search", exact: true }).click();
  await desk.getByRole("link", { name: patientName }).click();
  await desk.getByRole("link", { name: "Book appointment" }).click();
  await desk.locator('input[name="date"]').fill(leaveDay);
  const slot = desk.locator("button[aria-pressed]").first();
  await expect(slot).toBeVisible();
  const time = (await slot.innerText()).trim();
  await slot.click();
  await desk.getByRole("button", { name: `Book ${time}` }).click();
  await desk.waitForURL(/\/appointments\?date=/);

  // The admin marks that day as leave and is told a booking needs moving.
  const admin = adminPage;
  await admin.goto("/settings/schedules");
  await admin.getByRole("link", { name: "Edit" }).first().click();
  await admin.locator('input[name="date"]').fill(leaveDay);
  await admin.locator('input[name="reason"]').fill("Conference");
  await admin.getByRole("button", { name: "Add leave" }).click();
  await expect(admin.getByText("1 booked appointment needs moving")).toBeVisible();
  await expect(admin.getByText("1 booked: move them")).toBeVisible();

  // Rescheduling offers nothing on the leave day, then moves to the next day.
  await desk.goto(`/appointments?date=${leaveDay}`);
  await desk.getByRole("button", { name: `Reschedule ${patientName}` }).click();
  const dialog = desk.getByRole("dialog");
  await expect(dialog.getByText("No free slots that day")).toBeVisible();
  await dialog.getByLabel("Day").fill(newDay);
  const free = dialog.getByRole("group", { name: "Free slots" }).getByRole("button").first();
  await expect(free).toBeVisible();
  const newTime = (await free.innerText()).trim();
  await free.click();
  await dialog.getByRole("button", { name: `Move to ${newTime}` }).click();
  await expect(desk.getByText(`Moved to ${newDay} at ${newTime}`)).toBeVisible();

  await desk.goto(`/appointments?date=${newDay}`);
  await expect(desk.getByText(patientName)).toBeVisible();
  await admin.reload();
  await expect(admin.getByText("1 booked: move them")).toHaveCount(0);
});

test("WhatsApp: consent first, then a broadcast reaches only patients who agreed", async () => {
  const page = adminPage;
  await page.goto("/settings/messaging");
  await page.getByLabel("Phone number ID").fill("1234567890");
  await page.getByLabel("Access token").fill("e2e-test-token");
  await page.getByText("Messaging on", { exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Messaging settings saved")).toBeVisible();
  await page.getByRole("button", { name: "Add template" }).click();
  await page.getByLabel("Template name").fill("health_camp");
  await page.getByLabel("What the patient reads").fill("Hi {{1}}, free eye check-up this Sunday.");
  await page.getByRole("button", { name: "Add template" }).last().click();
  await expect(page.getByText("Template saved")).toBeVisible();

  // Nobody has agreed yet: nothing can be sent.
  await page.goto("/broadcasts");
  await page.getByLabel("Title (for your records)").fill(`Eye camp ${suffix}`);
  await expect(page.getByLabel("Audience")).toContainText("0 will receive it");
  await expect(page.getByRole("button", { name: "Review and send" })).toBeDisabled();

  // The receptionist records Anika's consent.
  await deskPage.goto("/patients");
  await deskPage.getByRole("searchbox", { name: "Search patients" }).fill(patientName);
  await deskPage.getByRole("button", { name: "Search", exact: true }).click();
  await deskPage.getByRole("link", { name: patientName }).click();
  const consent = deskPage.locator("section", { has: deskPage.getByRole("heading", { name: "Messaging consent" }) });
  await consent.locator("li", { hasText: "clinic updates" }).getByRole("button", { name: "Patient agrees" }).click();
  await expect(deskPage.getByText("Consent recorded")).toBeVisible();

  await page.reload();
  await page.getByLabel("Title (for your records)").fill(`Eye camp ${suffix}`);
  await expect(page.getByLabel("Audience")).toContainText("1 will receive it");
  await page.getByRole("button", { name: "Review and send" }).click();
  await page.getByRole("button", { name: "Send now" }).click();
  await expect(page.getByText("Queued for 1 patients")).toBeVisible();

  // One worker pass (test mode: recorded, not sent to Meta).
  execSync("npm run worker -- --once", { stdio: "ignore" });
  await page.reload();
  await expect(page.locator("tr", { hasText: `Eye camp ${suffix}` })).toContainText("1 sent");
});

test("Import: one bad row means nothing is imported; a clean file imports", async () => {
  const page = adminPage;
  await page.goto("/settings/import");
  const header = "first_name,last_name,sex,age,mobile,consent_reminders";
  const upload = (name: string, rows: string[]) =>
    page.getByLabel("CSV file").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from([header, ...rows].join("\n")) });

  await upload("bad.csv", [`Imran,Q${suffix},male,51,9845071111,yes`, "Broken,Row,dragon,,,"]);
  await page.getByRole("button", { name: "Check file" }).click();
  const problems = page.getByRole("alert").filter({ hasText: "Nothing will be imported" });
  await expect(problems).toContainText("Nothing will be imported until they are fixed");
  await expect(problems).toContainText("Line 3");
  await expect(page.getByRole("button", { name: /^Import \d+ patients$/ })).toHaveCount(0);

  await upload("good.csv", [`Imran,Q${suffix},male,51,9845071111,yes`, `Sana,Q${suffix},female,29,9845072222,no`]);
  await page.getByRole("button", { name: "Check file" }).click();
  await expect(page.getByRole("status").filter({ hasText: "rows are valid" })).toContainText("All 2 rows are valid");
  await page.getByRole("button", { name: "Import 2 patients" }).click();
  await expect(page.getByText("2 patients imported")).toBeVisible();
  await expect(page.locator("tr", { hasText: "good.csv" })).toContainText("2 imported");
});

test("Analyst sees de-identified analytics only; small numbers stay hidden", async () => {
  const page = analystPage;
  await clinicFirstSignIn(page, clinicCode, accounts.analyst.email, accounts.analyst.otp, accounts.analyst.password, "**/analytics");
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
  // A handful of patients: the count is hidden, and no name appears anywhere.
  await expect(page.getByText("<5").first()).toBeVisible();
  await expect(page.getByText(patientName)).toHaveCount(0);
  await expect(page.getByText("P-000001")).toHaveCount(0);

  await page.getByRole("link", { name: "Cohorts" }).click();
  await page.getByRole("button", { name: "New cohort" }).click();
  await page.getByLabel("Name", { exact: true }).fill(`Sore throats ${suffix}`);
  await page.getByLabel("Purpose").fill("How often acute pharyngitis is seen this month");
  await page.getByLabel("Diagnosed with (ICD-10 codes or prefixes)").fill("J02");
  await page.getByRole("button", { name: "Create cohort" }).click();
  await page.waitForURL(/\/analytics\/cohorts\/[0-9a-f-]+$/);
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByText("Row-level results are only shown for cohorts of 5 or more patients.")).toBeVisible();
  await expect(page.getByText(patientName)).toHaveCount(0);

  const exported = await page.request.get(`${page.url()}/export`);
  expect(exported.status()).toBe(422);

  for (const path of ["/patients", "/queue", new URL(encounterUrl).pathname, "/audit"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(403);
  }
});

test("Every page is served with a nonce-based CSP, and nothing is blocked", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(message.text())) violations.push(message.text());
  });
  await context.addCookies(await adminPage.context().cookies());
  for (const path of ["/login", "/today", new URL(encounterUrl).pathname, "/reports", "/analytics", "/billing", "/settings/catalog"]) {
    const response = await page.goto(path);
    const csp = response?.headers()["content-security-policy"] ?? "";
    expect(csp, path).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp, path).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp, path).toContain("frame-ancestors 'none'");
  }
  // The theme toggle (next-themes inline script + client JS) still works under the policy.
  await page.goto("/today");
  await page.getByRole("button", { name: "Toggle theme" }).click();
  expect(violations).toEqual([]);
  await context.close();
});
