import "server-only";

import { db, type TxDb } from "@/lib/db";
import { patients, users, appointments, doctors } from "@/lib/db/schema";
import { eq, isNull, and, sql, desc, ne } from "drizzle-orm";
import type { PatientProfileInput } from "./patient.schema";

// Names are stored on `users` (the source of truth) and mirrored onto
// `patients` for backwards compatibility.

export async function createPatientProfile(
  userId: string,
  names: { firstName: string; lastName: string },
  txDb: TxDb = db,
) {
  const result = await txDb
    .insert(patients)
    .values({ userId, firstName: names.firstName, lastName: names.lastName })
    .returning();

  return result[0];
}

export async function getPatientIdByUserId(userId: string): Promise<string | null> {
  const result = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.userId, userId), isNull(patients.deletedAt)))
    .limit(1);
  return result[0]?.id ?? null;
}

export async function getPatientProfile(userId: string) {
  const result = await db
    .select({
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      gender: patients.gender,
      contactNumber: patients.contactNumber,
      address: patients.address,
    })
    .from(patients)
    .innerJoin(users, eq(patients.userId, users.id))
    .where(and(eq(patients.userId, userId), isNull(patients.deletedAt)))
    .limit(1);

  return result[0] ?? null;
}

export async function updatePatientProfile(userId: string, data: PatientProfileInput) {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ firstName: data.first_name, lastName: data.last_name, updatedAt: now })
      .where(eq(users.id, userId));

    await tx
      .update(patients)
      .set({
        firstName: data.first_name,
        lastName: data.last_name,
        gender: data.gender,
        contactNumber: data.contact_number,
        address: data.address || null,
        updatedAt: now,
      })
      .where(eq(patients.userId, userId));
  });
}

/** Patients who have (non-cancelled) appointments with the given doctor. */
export async function getPatientsForDoctor(doctorUserId: string) {
  // Raw SQL timestamps come back as strings from the postgres-js driver.
  const lastVisit = sql<string>`max(${appointments.appointmentDatetime})`;

  return db
    .select({
      patient_id: patients.id,
      first_name: users.firstName,
      last_name: users.lastName,
      email: users.email,
      gender: patients.gender,
      contact_number: patients.contactNumber,
      total_visits: sql<number>`count(${appointments.id})::int`,
      last_visit: lastVisit,
    })
    .from(appointments)
    .innerJoin(patients, eq(appointments.patientId, patients.id))
    .innerJoin(users, eq(patients.userId, users.id))
    .innerJoin(doctors, eq(appointments.doctorId, doctors.id))
    .where(
      and(
        eq(doctors.userId, doctorUserId),
        isNull(appointments.deletedAt),
        isNull(patients.deletedAt),
        ne(appointments.status, "cancelled"),
      ),
    )
    .groupBy(
      patients.id,
      users.firstName,
      users.lastName,
      users.email,
      patients.gender,
      patients.contactNumber,
    )
    .orderBy(desc(lastVisit));
}

export async function getAllPatientsAdmin() {
  return db
    .select({
      patient_id: patients.id,
      first_name: users.firstName,
      last_name: users.lastName,
      email: users.email,
      gender: patients.gender,
      contact_number: patients.contactNumber,
      created_at: users.createdAt,
      total_visits: sql<number>`count(${appointments.id})::int`,
    })
    .from(patients)
    .innerJoin(users, eq(patients.userId, users.id))
    .leftJoin(
      appointments,
      and(eq(appointments.patientId, patients.id), isNull(appointments.deletedAt)),
    )
    .where(and(isNull(patients.deletedAt), isNull(users.deletedAt)))
    .groupBy(
      patients.id,
      users.firstName,
      users.lastName,
      users.email,
      patients.gender,
      patients.contactNumber,
      users.createdAt,
    )
    .orderBy(desc(users.createdAt));
}
