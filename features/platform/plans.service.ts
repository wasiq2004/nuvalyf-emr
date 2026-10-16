import "server-only";

import { asc, eq, sql } from "drizzle-orm";
import type { Queryable } from "@/lib/db";
import { clinics, planModules, plans } from "@/lib/db/schema";
import { validateModuleSelection } from "@/lib/access/modules";
import { AppError, isUniqueViolation } from "@/lib/errors";

export type PlanWithModules = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  modules: string[];
  clinicCount: number;
};

export async function listPlans(db: Queryable): Promise<PlanWithModules[]> {
  const rows = await db
    .select({
      id: plans.id,
      name: plans.name,
      description: plans.description,
      isActive: plans.isActive,
      clinicCount: sql<number>`(select count(*)::int from ${clinics} where ${clinics.planId} = ${plans.id})`,
    })
    .from(plans)
    .orderBy(asc(plans.name));

  const moduleRows = await db.select().from(planModules);
  return rows.map((plan) => ({
    ...plan,
    clinicCount: Number(plan.clinicCount),
    modules: moduleRows.filter((m) => m.planId === plan.id).map((m) => m.module),
  }));
}

function assertValidModules(modules: string[]) {
  const problem = validateModuleSelection(modules);
  if (problem) throw new AppError(problem);
}

export async function createPlan(
  db: Queryable,
  input: { name: string; description?: string; modules: string[] },
): Promise<{ id: string }> {
  assertValidModules(input.modules);
  try {
    return await db.transaction(async (tx) => {
      const [plan] = await tx
        .insert(plans)
        .values({ name: input.name, description: input.description || null })
        .returning({ id: plans.id });
      if (input.modules.length > 0) {
        await tx.insert(planModules).values(input.modules.map((module) => ({ planId: plan.id, module })));
      }
      return plan;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("A plan with this name already exists.");
    throw error;
  }
}

export async function updatePlan(
  db: Queryable,
  input: { id: string; name: string; description?: string; modules: string[]; isActive: boolean },
) {
  assertValidModules(input.modules);
  try {
    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(plans)
        .set({ name: input.name, description: input.description || null, isActive: input.isActive, updatedAt: new Date() })
        .where(eq(plans.id, input.id))
        .returning({ id: plans.id });
      if (!updated) throw new AppError("Plan not found.");

      await tx.delete(planModules).where(eq(planModules.planId, input.id));
      if (input.modules.length > 0) {
        await tx.insert(planModules).values(input.modules.map((module) => ({ planId: input.id, module })));
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("A plan with this name already exists.");
    throw error;
  }
}
