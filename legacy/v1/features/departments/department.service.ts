import "server-only";

import { db } from "@/lib/db";
import { departments, doctors } from "@/lib/db/schema";
import { eq, asc, sql, and, isNull } from "drizzle-orm";

export async function getDepartments() {
  return db
    .select({
      id: departments.id,
      name: departments.name,
      description: departments.description,
      doctorCount: sql<number>`count(${doctors.id})::int`,
    })
    .from(departments)
    .leftJoin(doctors, and(eq(doctors.departmentId, departments.id), isNull(doctors.deletedAt)))
    .groupBy(departments.id, departments.name, departments.description)
    .orderBy(asc(departments.name));
}

export async function getDepartmentOptions() {
  return db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .orderBy(asc(departments.name));
}

export async function createDepartment(name: string, description?: string) {
  const result = await db
    .insert(departments)
    .values({ name, description: description || null })
    .returning();

  return result[0];
}

export async function deleteDepartment(id: string) {
  return db.delete(departments).where(eq(departments.id, id)).returning({ id: departments.id });
}
