import "server-only";

import { db, type TxDb } from "@/lib/db";
import { doctors, users, departments } from "@/lib/db/schema";
import { eq, isNull, and, desc, asc } from "drizzle-orm";
import { displayName } from "@/features/auth/auth.service";

export async function createDoctorProfile(
  userId: string,
  data: {
    specialization: string;
    license_number: string;
    years_of_experience: number;
    department_id: string;
  },
  txDb: TxDb = db,
) {
  const result = await txDb
    .insert(doctors)
    .values({
      userId,
      specialization: data.specialization,
      licenseNumber: data.license_number,
      yearsOfExperience: data.years_of_experience,
      departmentId: data.department_id,
    })
    .returning();

  return result[0];
}

export async function getDoctorIdByUserId(userId: string): Promise<string | null> {
  const result = await db
    .select({ id: doctors.id })
    .from(doctors)
    .where(and(eq(doctors.userId, userId), isNull(doctors.deletedAt)))
    .limit(1);
  return result[0]?.id ?? null;
}

/** Admin listing, optionally filtered by department. */
export async function getDoctors(departmentId?: string) {
  const activeDoctor = and(isNull(doctors.deletedAt), isNull(users.deletedAt));
  const whereClause = departmentId
    ? and(eq(doctors.departmentId, departmentId), activeDoctor)
    : activeDoctor;

  const result = await db
    .select({
      id: doctors.id,
      specialization: doctors.specialization,
      license_number: doctors.licenseNumber,
      years_of_experience: doctors.yearsOfExperience,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      department_name: departments.name,
    })
    .from(doctors)
    .innerJoin(users, eq(doctors.userId, users.id))
    .leftJoin(departments, eq(doctors.departmentId, departments.id))
    .where(whereClause)
    .orderBy(desc(doctors.createdAt));

  return result.map((d) => ({
    ...d,
    name: displayName(d.firstName, d.lastName) || "Unnamed doctor",
  }));
}

/** Doctors a patient can book with. */
export async function getBookableDoctors() {
  const result = await db
    .select({
      id: doctors.id,
      firstName: users.firstName,
      lastName: users.lastName,
      specialization: doctors.specialization,
      department: departments.name,
      yearsOfExperience: doctors.yearsOfExperience,
    })
    .from(doctors)
    .innerJoin(users, eq(doctors.userId, users.id))
    .leftJoin(departments, eq(doctors.departmentId, departments.id))
    .where(and(isNull(doctors.deletedAt), isNull(users.deletedAt)))
    .orderBy(asc(users.lastName), asc(users.firstName));

  return result.map((d) => ({
    id: d.id,
    name: displayName(d.firstName, d.lastName) || "Doctor",
    specialization: d.specialization,
    department: d.department ?? "General",
    yearsOfExperience: d.yearsOfExperience ?? 0,
  }));
}

export type BookableDoctor = Awaited<ReturnType<typeof getBookableDoctors>>[number];
