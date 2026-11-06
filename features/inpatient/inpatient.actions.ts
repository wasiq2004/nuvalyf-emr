"use server";

// Admissions, beds, the running bill and the discharge summary.
import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { staffName } from "@/features/clinical/encounters.service";
import { isValidDateString, isValidTimeString, todayInTimeZone, zonedTimeToUtc } from "@/lib/time";
import { idField, optionalId, optionalInt, optionalMoney, optionalPhone, optionalText, requiredText } from "@/lib/validation";
import { PAYMENT_METHODS } from "@/features/billing/billing-rules";
import { BILLING_MODES } from "./bed-billing-rules";
import { choiceFrom } from "./summary-rules";
import {
  addCharge,
  adjustBedStay,
  admitPatient,
  dischargePatient,
  recordAdmissionPayment,
  saveBed,
  saveBedCategory,
  saveInpatientSettings,
  setAdmissionDiscount,
  transferBed,
  voidCharge,
} from "./inpatient.service";
import { draftSummary, saveSummary, signSummary } from "./summary.service";

const MODULE = "inpatient" as const;
const requiredMoney = (label: string) => z.string({ message: `${label} is required` }).trim().regex(/^\d{1,9}(\.\d{1,2})?$/, `${label}: enter an amount like 500 or 500.50`);
const date = z.string({ message: "Enter the date" }).refine(isValidDateString, "Enter the date");
const time = z.string({ message: "Enter the time" }).refine(isValidTimeString, "Enter the time");

export const saveInpatientSettingsAction = clinicAction(
  {
    name: "inpatient.saveSettings",
    permission: "settings:manage",
    module: MODULE,
    schema: z.object({
      billingMode: z.enum(BILLING_MODES),
      minimumHours: z.coerce.number({ message: "Enter the hours" }).int().min(0).max(240),
      sections: z.array(z.string()).default([]),
      customSections: z.string().max(2000).default(""),
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const sections = choiceFrom(input.sections, input.customSections.split(/\r?\n/));
      await saveInpatientSettings(tx, session.clinicId, { billingMode: input.billingMode, minimumHours: input.minimumHours, sections }, session.userId);
      await audit(tx, { action: "INPATIENT_SETTINGS_UPDATED", targetType: "clinic", targetId: session.clinicId, details: { billingMode: input.billingMode, minimumHours: input.minimumHours } });
    }),
);

export const saveBedCategoryAction = clinicAction(
  {
    name: "inpatient.saveCategory",
    permission: "settings:manage",
    module: MODULE,
    schema: z.object({ id: optionalId, name: requiredText(80, "Name"), dailyRate: requiredMoney("The daily rate") }),
  },
  async ({ session, db, audit }, { id, ...input }) =>
    db(async (tx) => {
      const row = await saveBedCategory(tx, session.clinicId, id, input);
      await audit(tx, { action: id ? "BED_CATEGORY_UPDATED" : "BED_CATEGORY_ADDED", targetType: "bed_category", targetId: row.id, details: input });
    }),
);

export const saveBedAction = clinicAction(
  {
    name: "inpatient.saveBed",
    permission: "settings:manage",
    module: MODULE,
    schema: z.object({ id: optionalId, categoryId: idField, ward: optionalText(80), code: requiredText(30, "Bed number") }),
  },
  async ({ session, db, audit }, { id, ...input }) =>
    db(async (tx) => {
      const row = await saveBed(tx, session.clinicId, id, input);
      await audit(tx, { action: id ? "BED_UPDATED" : "BED_ADDED", targetType: "bed", targetId: row.id, details: { code: input.code } });
    }),
);

export const admitPatientAction = clinicAction(
  {
    name: "inpatient.admit",
    permission: "inpatient:admit",
    module: MODULE,
    schema: z.object({
      patientId: idField,
      doctorId: idField,
      bedId: idField,
      reason: requiredText(500, "The reason for admission"),
      date,
      time,
      attendantName: optionalText(120),
      attendantPhone: optionalPhone,
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await admitPatient(tx, session.clinicId, { ...input, admittedAt: zonedTimeToUtc(input.date, input.time, session.timezone) }, session.userId, todayInTimeZone(session.timezone));
      await audit(tx, { action: "PATIENT_ADMITTED", targetType: "admission", targetId: row.id, patientId: input.patientId, details: { number: row.number } });
      return row;
    }),
);

export const transferBedAction = clinicAction(
  { name: "inpatient.transfer", permission: "inpatient:admit", module: MODULE, schema: z.object({ admissionId: idField, bedId: idField, date, time }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await transferBed(tx, session.clinicId, input.admissionId, input.bedId, zonedTimeToUtc(input.date, input.time, session.timezone));
      await audit(tx, { action: "PATIENT_BED_CHANGED", targetType: "admission", targetId: input.admissionId, patientId: row.patientId, details: { from: row.from, to: row.to } });
    }),
);

export const dischargePatientAction = clinicAction(
  { name: "inpatient.discharge", permission: "inpatient:admit", module: MODULE, schema: z.object({ admissionId: idField, date, time }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await dischargePatient(tx, input.admissionId, zonedTimeToUtc(input.date, input.time, session.timezone), session.userId);
      await audit(tx, { action: "PATIENT_DISCHARGED", targetType: "admission", targetId: input.admissionId, patientId: row.patientId, details: { number: row.number } });
    }),
);

const CHARGE_KINDS = ["doctor", "nursing", "procedure", "lab", "pharmacy", "other"] as const;

export const addChargeAction = clinicAction(
  {
    name: "inpatient.addCharge",
    permission: "inpatient:bill",
    module: MODULE,
    schema: z.object({
      admissionId: idField,
      kind: z.enum(CHARGE_KINDS),
      description: requiredText(300, "A description"),
      quantity: z.coerce.number({ message: "Enter the quantity" }).int().min(1).max(10000),
      unitAmount: requiredMoney("The amount"),
    }),
  },
  async ({ session, db, audit }, { admissionId, ...input }) =>
    db(async (tx) => {
      const row = await addCharge(tx, session.clinicId, admissionId, input, session.userId);
      await audit(tx, { action: "ADMISSION_CHARGE_ADDED", targetType: "admission", targetId: admissionId, patientId: row.patientId, details: { kind: input.kind, amount: input.unitAmount, quantity: input.quantity } });
    }),
);

export const voidChargeAction = clinicAction(
  { name: "inpatient.voidCharge", permission: "inpatient:adjust", module: MODULE, schema: z.object({ chargeId: idField, reason: requiredText(300, "A reason") }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await voidCharge(tx, input.chargeId, input.reason, session.userId);
      await audit(tx, { action: "ADMISSION_CHARGE_VOIDED", targetType: "admission", targetId: row.admissionId, severity: "warning", details: { amount: row.amount, reason: input.reason } });
    }),
);

export const adjustBedStayAction = clinicAction(
  {
    name: "inpatient.adjustBed",
    permission: "inpatient:adjust",
    module: MODULE,
    schema: z.object({ stayId: idField, hours: optionalInt(0, 100000, "Hours"), rate: optionalMoney, reason: requiredText(300, "A reason") }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await adjustBedStay(tx, input.stayId, { hours: input.hours ?? null, rate: input.rate ?? null, reason: input.reason }, session.userId);
      await audit(tx, { action: "ADMISSION_BED_ADJUSTED", targetType: "admission", targetId: row.admissionId, severity: "warning", details: { bed: row.bed, hours: input.hours ?? null, rate: input.rate ?? null, reason: input.reason } });
    }),
);

export const setDiscountAction = clinicAction(
  { name: "inpatient.discount", permission: "inpatient:adjust", module: MODULE, schema: z.object({ admissionId: idField, discount: requiredMoney("The discount"), reason: requiredText(300, "A reason") }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await setAdmissionDiscount(tx, input.admissionId, input.discount, input.reason, session.userId);
      await audit(tx, { action: "ADMISSION_DISCOUNT_SET", targetType: "admission", targetId: input.admissionId, patientId: row.patientId, severity: "warning", details: { discount: input.discount, reason: input.reason } });
    }),
);

export const recordPaymentAction = clinicAction(
  {
    name: "inpatient.payment",
    permission: "inpatient:bill",
    module: MODULE,
    schema: z.object({
      admissionId: idField,
      kind: z.enum(["advance", "payment", "refund"]),
      amount: requiredMoney("The amount"),
      method: z.enum(PAYMENT_METHODS),
      reference: optionalText(100),
      note: optionalText(300),
      idempotencyKey: z.string().trim().min(16, "Reload the page and try again.").max(64),
    }),
  },
  async ({ session, db, audit }, { admissionId, ...input }) =>
    db(async (tx) => {
      const row = await recordAdmissionPayment(tx, session.clinicId, admissionId, input, session.userId, todayInTimeZone(session.timezone));
      if (!row.replayed) {
        await audit(tx, { action: "ADMISSION_PAYMENT", targetType: "admission", targetId: admissionId, patientId: row.patientId, details: { number: row.number, kind: input.kind, amount: input.amount, method: input.method } });
      }
      return { number: row.number };
    }),
);

export const draftSummaryAction = clinicAction(
  { name: "inpatient.draftSummary", permission: "inpatient:read", module: MODULE, schema: z.object({ admissionId: idField }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      await draftSummary(tx, session.clinicId, input.admissionId, session.userId, todayInTimeZone(session.timezone), session.timezone);
      await audit(tx, { action: "CONSULTATION_DISCHARGE_DRAFTED", targetType: "admission", targetId: input.admissionId });
    }),
);

const summaryBodies = z.array(z.object({ key: z.string().max(40), body: z.string().max(8000) })).max(40);

export const saveSummaryAction = clinicAction(
  { name: "inpatient.saveSummary", permission: "discharge:sign", module: MODULE, schema: z.object({ admissionId: idField, sections: summaryBodies }) },
  async ({ db, audit }, input) =>
    db(async (tx) => {
      await saveSummary(tx, input.admissionId, input.sections);
      await audit(tx, { action: "CONSULTATION_DISCHARGE_SAVED", targetType: "admission", targetId: input.admissionId });
    }),
);

export const signSummaryAction = clinicAction(
  { name: "inpatient.signSummary", permission: "discharge:sign", module: MODULE, schema: z.object({ admissionId: idField, sections: summaryBodies }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      await saveSummary(tx, input.admissionId, input.sections);
      await signSummary(tx, input.admissionId, { id: session.userId, name: staffName(session), registrationNumber: session.registrationNumber });
      await audit(tx, { action: "CONSULTATION_DISCHARGE_SIGNED", targetType: "admission", targetId: input.admissionId });
    }),
);
