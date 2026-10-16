// Phase 7: the audit trail as the compliance panel reads it, and reports.
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ownerSql } from "./test-db";
import { createTestClinic } from "./fixtures";
import { withClinic } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { drugs } from "@/lib/db/schema";
import { createStaff } from "@/features/staff/staff.service";
import { registerPatient } from "@/features/patients/patients.service";
import { addInvoiceItem, createInvoice, issueInvoice, recordPayment, recordRefund } from "@/features/billing/billing.service";
import { receiveStock } from "@/features/pharmacy/stock.service";
import { sell } from "@/features/pharmacy/sales.service";
import { auditSummary, recordAccess, searchAudit } from "@/features/audit/audit.service";
import { collectionsByDay, collectionsByMethod, outstandingAging } from "@/features/reports/reports.service";
import { addDaysToDateString, todayInTimeZone, zonedTimeToUtc } from "@/lib/time";

const TZ = "Asia/Kolkata";
const owner = ownerSql();
const today = todayInTimeZone(TZ);
const range = {
  from: zonedTimeToUtc(addDaysToDateString(today, -1), "00:00", TZ),
  to: zonedTimeToUtc(addDaysToDateString(today, 1), "00:00", TZ),
  fromDate: addDaysToDateString(today, -1),
  toDate: today,
  timeZone: TZ,
};
const filters = { from: range.fromDate, to: today };

let clinic: Awaited<ReturnType<typeof createTestClinic>>;
let adminId: string;
let deskId: string;
let auditorId: string;
let patient: { id: string; mrn: string };

const as = (userId: string) => <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic({ clinicId: clinic.clinicId, userId }, fn);
const event = (actor: string, action: string, extra: Partial<Parameters<typeof recordAudit>[1]> = {}) =>
  as(actor)((tx) => recordAudit(tx, { clinicId: clinic.clinicId, actorUserId: actor, action, ...extra }));

beforeAll(async () => {
  clinic = await createTestClinic("compliance");
  const [admin] = await owner`select id from app.users where clinic_id = ${clinic.clinicId}`;
  adminId = admin.id;
  const mk = (firstName: string, roleKeys: string[]) =>
    as(adminId)((tx) => createStaff(tx, clinic.clinicId, { firstName, lastName: "Staff", email: `${firstName.toLowerCase()}@compliance.test`, roleKeys }, adminId));
  deskId = (await mk("Dina", ["receptionist"])).id;
  auditorId = (await mk("Arun", ["auditor"])).id;
  patient = await as(adminId)((tx) =>
    registerPatient(tx, clinic.clinicId, { firstName: "Priya", lastName: "Audit", sex: "female", statedAgeYears: 33 }, { likelyIds: [], actorId: adminId, today }),
  );

  await event(deskId, "PATIENT_VIEWED", { patientId: patient.id, targetType: "patient", targetId: patient.id });
  await event(deskId, "PATIENT_VIEWED", { patientId: patient.id, targetType: "patient", targetId: patient.id });
  await event(adminId, "ENCOUNTER_VIEWED", { patientId: patient.id, targetType: "encounter" });
  await event(adminId, "PRESCRIPTION_ITEM_ADDED", { patientId: patient.id, details: { drug: "Sertraline 50" } });
  await event(deskId, "ACTION_DENIED", { outcome: "denied", severity: "critical", details: { action: "clinical.saveNotes" } });
});

afterAll(async () => {
  await owner.end();
});

describe("audit trail", () => {
  it("answers who opened a patient's record, and how often", async () => {
    const access = await as(auditorId)((tx) => recordAccess(tx, patient.mrn, range));
    expect(access!.patient.mrn).toBe(patient.mrn);
    const byName = Object.fromEntries(access!.people.map((p) => [p.name, p.views]));
    expect(byName).toEqual({ "Dina Staff": 2, "Ada Admin": 1 });
    expect(access!.people.find((p) => p.name === "Dina Staff")!.roles).toBe("Receptionist");
    expect(await as(auditorId)((tx) => recordAccess(tx, "P-999999", range))).toBeNull();
  });

  it("withholds clinical details from the auditor", async () => {
    const page = await as(auditorId)((tx) => searchAudit(tx, { ...filters, action: "PRESCRIPTION_ITEM_ADDED" }, range, null));
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].details).toEqual({ withheld: expect.any(String) });
    expect(JSON.stringify(page.rows)).not.toContain("Sertraline");
  });

  it("filters by person and outcome, and pages with a cursor", async () => {
    const denied = await as(auditorId)((tx) => searchAudit(tx, { ...filters, outcome: "denied" }, range, null));
    expect(denied.rows.map((r) => r.action)).toEqual(["ACTION_DENIED"]);
    expect(denied.rows[0].actorName).toBe("Dina Staff");

    const first = await as(auditorId)((tx) => searchAudit(tx, { ...filters, actorId: deskId }, range, null, 2));
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await as(auditorId)((tx) => searchAudit(tx, { ...filters, actorId: deskId }, range, first.nextCursor, 2));
    expect(second.rows.map((r) => r.id)).not.toContain(first.rows[0].id);
    expect(second.rows.every((r) => r.createdAt <= first.rows[1].createdAt)).toBe(true);

    const unknown = await as(auditorId)((tx) => searchAudit(tx, { ...filters, patientMrn: "P-424242" }, range, null));
    expect(unknown.patientNotFound).toBe(true);
  });

  it("summarises activity and refusals", async () => {
    const summary = await as(auditorId)((tx) => auditSummary(tx, range, TZ));
    expect(summary.totals.denied).toBe(1);
    expect(summary.totals.critical).toBe(1);
    expect(summary.totals.recordViews).toBeGreaterThanOrEqual(3);
    expect(summary.denials[0].action).toBe("ACTION_DENIED");
  });
});

describe("reports", () => {
  it("adds clinic billing (net of refunds) and pharmacy sales per day and method", async () => {
    const inv = await as(adminId)((tx) => createInvoice(tx, clinic.clinicId, patient.id, adminId));
    await as(adminId)((tx) => addInvoiceItem(tx, clinic.clinicId, inv.id, { kind: "other", description: "Consult", quantity: 1, unitPrice: "800" }));
    await as(adminId)((tx) => issueInvoice(tx, inv.id, adminId));
    await as(adminId)((tx) => recordPayment(tx, clinic.clinicId, { invoiceId: inv.id, amount: "500", method: "upi", idempotencyKey: randomUUID() }, adminId));
    await as(adminId)((tx) => recordRefund(tx, clinic.clinicId, { invoiceId: inv.id, amount: "100", method: "upi", reason: "Overcharged", idempotencyKey: randomUUID() }, adminId));

    const [para] = await as(adminId)((tx) => tx.update(drugs).set({ price: "3.00" }).where(eq(drugs.name, "Paracetamol 500")).returning({ id: drugs.id }));
    const batch = await as(adminId)((tx) =>
      receiveStock(tx, clinic.clinicId, { drugId: para.id, batchNo: "R1", expiryDate: addDaysToDateString(today, 200), quantity: 10, reason: "opening" }, adminId, today),
    );
    await as(adminId)((tx) => sell(tx, clinic.clinicId, { lines: [{ drugId: para.id, batchId: batch.batchId, quantity: 4 }], method: "cash", idempotencyKey: randomUUID() }, adminId, today));

    const byDay = await as(adminId)((tx) => collectionsByDay(tx, range));
    expect(byDay).toEqual([{ day: today, billing: "400.00", pharmacy: "12.00" }]);
    const byMethod = await as(adminId)((tx) => collectionsByMethod(tx, range));
    expect(byMethod).toEqual([
      { method: "cash", billing: "0.00", pharmacy: "12.00", total: "12.00" },
      { method: "upi", billing: "400.00", pharmacy: "0.00", total: "400.00" },
    ]);
    const aging = await as(adminId)((tx) => outstandingAging(tx, new Date()));
    expect(aging[0]).toEqual({ bucket: "0-30", invoices: 1, amount: "400.00" });
    expect(aging[3]).toEqual({ bucket: "90+", invoices: 0, amount: "0.00" });
  });
});
