import "server-only";

import { count, desc, eq, sql } from "drizzle-orm";
import type { Queryable } from "@/lib/db";
import { clinicUsage, clinics, operators, planModules, plans, platformAuditEvents } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";

export type ClinicListItem = {
  id: string;
  name: string;
  code: string;
  status: string;
  planId: string | null;
  planName: string | null;
  staffTotal: number;
  staffActive: number;
  lastActivityAt: Date | null;
  createdAt: Date;
};

export async function listClinics(db: Queryable): Promise<ClinicListItem[]> {
  const rows = await db
    .select({
      id: clinics.id,
      name: clinics.name,
      code: clinics.code,
      status: clinics.status,
      planId: clinics.planId,
      planName: plans.name,
      staffTotal: clinicUsage.staffTotal,
      staffActive: clinicUsage.staffActive,
      lastActivityAt: clinicUsage.lastActivityAt,
      createdAt: clinics.createdAt,
    })
    .from(clinics)
    .leftJoin(plans, eq(plans.id, clinics.planId))
    .leftJoin(clinicUsage, eq(clinicUsage.clinicId, clinics.id))
    .orderBy(clinics.name);

  return rows.map((r) => ({
    ...r,
    staffTotal: r.staffTotal ?? 0,
    staffActive: r.staffActive ?? 0,
  }));
}

export async function getClinic(db: Queryable, id: string) {
  const [row] = await db
    .select({
      clinic: clinics,
      planName: plans.name,
      staffTotal: clinicUsage.staffTotal,
      staffActive: clinicUsage.staffActive,
      lastActivityAt: clinicUsage.lastActivityAt,
    })
    .from(clinics)
    .leftJoin(plans, eq(plans.id, clinics.planId))
    .leftJoin(clinicUsage, eq(clinicUsage.clinicId, clinics.id))
    .where(eq(clinics.id, id))
    .limit(1);
  if (!row) return null;

  const modules = row.clinic.planId
    ? (await db.select({ module: planModules.module }).from(planModules).where(eq(planModules.planId, row.clinic.planId))).map(
        (m) => m.module,
      )
    : [];

  return {
    ...row.clinic,
    planName: row.planName,
    modules,
    staffTotal: row.staffTotal ?? 0,
    staffActive: row.staffActive ?? 0,
    lastActivityAt: row.lastActivityAt,
  };
}

export async function setClinicStatus(
  db: Queryable,
  input: { clinicId: string; status: "active" | "suspended"; reason?: string },
) {
  const [updated] = await db
    .update(clinics)
    .set({
      status: input.status,
      suspendedAt: input.status === "suspended" ? new Date() : null,
      suspendedReason: input.status === "suspended" ? (input.reason ?? null) : null,
      updatedAt: new Date(),
    })
    .where(eq(clinics.id, input.clinicId))
    .returning({ id: clinics.id, code: clinics.code });
  if (!updated) throw new AppError("Clinic not found.");
  return updated;
}

export async function setClinicPlan(db: Queryable, input: { clinicId: string; planId: string | null }) {
  if (input.planId) {
    const [plan] = await db.select({ id: plans.id, isActive: plans.isActive }).from(plans).where(eq(plans.id, input.planId));
    if (!plan) throw new AppError("Plan not found.");
    if (!plan.isActive) throw new AppError("That plan is retired and cannot be assigned.");
  }
  const [updated] = await db
    .update(clinics)
    .set({ planId: input.planId, updatedAt: new Date() })
    .where(eq(clinics.id, input.clinicId))
    .returning({ id: clinics.id });
  if (!updated) throw new AppError("Clinic not found.");
}

export async function updateClinicContact(
  db: Queryable,
  input: { clinicId: string; name: string; contactName?: string; contactEmail?: string; contactPhone?: string },
) {
  const [updated] = await db
    .update(clinics)
    .set({
      name: input.name,
      contactName: input.contactName || null,
      contactEmail: input.contactEmail || null,
      contactPhone: input.contactPhone || null,
      updatedAt: new Date(),
    })
    .where(eq(clinics.id, input.clinicId))
    .returning({ id: clinics.id });
  if (!updated) throw new AppError("Clinic not found.");
}

export async function getEstateSummary(db: Queryable) {
  const [totals] = await db
    .select({
      total: count(),
      active: sql<number>`count(*) filter (where ${clinics.status} = 'active')::int`,
      suspended: sql<number>`count(*) filter (where ${clinics.status} = 'suspended')::int`,
      withoutPlan: sql<number>`count(*) filter (where ${clinics.planId} is null)::int`,
    })
    .from(clinics);

  const [staff] = await db
    .select({ active: sql<number>`coalesce(sum(${clinicUsage.staffActive}), 0)::int` })
    .from(clinicUsage);

  const [operatorCount] = await db.select({ n: count() }).from(operators).where(eq(operators.status, "active"));

  const recent = await db
    .select({
      id: platformAuditEvents.id,
      action: platformAuditEvents.action,
      targetType: platformAuditEvents.targetType,
      targetId: platformAuditEvents.targetId,
      outcome: platformAuditEvents.outcome,
      createdAt: platformAuditEvents.createdAt,
      operatorName: operators.name,
    })
    .from(platformAuditEvents)
    .leftJoin(operators, eq(operators.id, platformAuditEvents.operatorId))
    .orderBy(desc(platformAuditEvents.createdAt))
    .limit(12);

  return {
    clinics: {
      total: Number(totals?.total ?? 0),
      active: Number(totals?.active ?? 0),
      suspended: Number(totals?.suspended ?? 0),
      withoutPlan: Number(totals?.withoutPlan ?? 0),
    },
    activeStaff: Number(staff?.active ?? 0),
    activeOperators: Number(operatorCount?.n ?? 0),
    recent,
  };
}
