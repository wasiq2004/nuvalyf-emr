import "server-only";

// Consultations: triage hand-over, calling patients, notes, signing and
// amendments. Every function runs inside withClinic() (RLS-scoped).
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import {
  appointments,
  clinicSettings,
  diagnoses,
  encounterAmendments,
  encounters,
  patients,
  prescriptionItems,
  prescriptions,
  privateNotes,
  users,
  visits,
} from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { ageOn, displayPatientName } from "@/features/patients/patient-rules";
import { listQueue, type QueueItem } from "@/features/queue/queue.service";

export function staffName(u: { title?: string | null; firstName: string; lastName: string }) {
  return [u.title, u.firstName, u.lastName].filter(Boolean).join(" ");
}

/** The consultation for a visit, created on first touch (triage or call). */
export async function ensureEncounter(
  tx: Tx,
  clinicId: string,
  visit: { id: string; patientId: string },
  doctorId: string | null,
): Promise<string> {
  const [created] = await tx
    .insert(encounters)
    .values({ clinicId, visitId: visit.id, patientId: visit.patientId, doctorId })
    .onConflictDoNothing({ target: encounters.visitId })
    .returning({ id: encounters.id });
  if (created) return created.id;
  const [existing] = await tx.select({ id: encounters.id }).from(encounters).where(eq(encounters.visitId, visit.id)).limit(1);
  return existing.id;
}

// ---------------------------------------------------------------------------
// Queue transitions
// ---------------------------------------------------------------------------

/** Nurse picks a patient up for triage. */
export async function startTriage(tx: Tx, clinicId: string, visitId: string, today: string) {
  const [visit] = await tx
    .update(visits)
    .set({ status: "in_triage", triageStartedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(visits.id, visitId), eq(visits.status, "waiting"), eq(visits.visitDate, today)))
    .returning({ id: visits.id, patientId: visits.patientId, doctorId: visits.doctorId });
  if (!visit) throw new AppError("This patient is no longer waiting for triage.");
  const encounterId = await ensureEncounter(tx, clinicId, visit, visit.doctorId);
  return { visitId: visit.id, patientId: visit.patientId, encounterId };
}

/** Nurse hands the patient over: READY for the doctor. */
export async function handOver(tx: Tx, encounterId: string) {
  const encounter = await requireEncounter(tx, encounterId);
  const [visit] = await tx
    .update(visits)
    .set({ status: "ready", readyAt: new Date(), updatedAt: new Date() })
    .where(and(eq(visits.id, encounter.visitId), inArray(visits.status, ["waiting", "in_triage"])))
    .returning({ id: visits.id });
  if (!visit) throw new AppError("This patient is already with the doctor or has left the queue.");
  return { visitId: visit.id, patientId: encounter.patientId };
}

/**
 * Doctor calls a patient in. Stops the wait clock. A patient booked with
 * another doctor cannot be taken by mistake.
 */
export async function callPatient(tx: Tx, clinicId: string, visitId: string, doctorId: string, today: string) {
  const now = new Date();
  const [visit] = await tx
    .update(visits)
    .set({ status: "with_doctor", calledAt: now, doctorId: sql`coalesce(${visits.doctorId}, ${doctorId}::uuid)`, updatedAt: now })
    .where(
      and(
        eq(visits.id, visitId),
        eq(visits.visitDate, today),
        inArray(visits.status, ["waiting", "in_triage", "ready"]),
        or(isNull(visits.doctorId), eq(visits.doctorId, doctorId)),
      ),
    )
    .returning({ id: visits.id, patientId: visits.patientId });

  if (!visit) {
    const [current] = await tx.select().from(visits).where(eq(visits.id, visitId)).limit(1);
    if (current && current.doctorId && current.doctorId !== doctorId && ["waiting", "in_triage", "ready"].includes(current.status)) {
      throw new AppError("This patient is waiting for another doctor.");
    }
    throw new AppError("This patient is no longer waiting.");
  }

  const encounterId = await ensureEncounter(tx, clinicId, visit, doctorId);
  await tx
    .update(encounters)
    .set({ doctorId, updatedAt: now })
    .where(and(eq(encounters.id, encounterId), isNull(encounters.doctorId)));
  return { visitId: visit.id, patientId: visit.patientId, encounterId };
}

/**
 * The next patient for this doctor: emergencies first, then patients the
 * nurse has made ready, then those still waiting, in queue order.
 */
export function pickNext(queue: QueueItem[], doctorId: string): QueueItem | undefined {
  const mine = queue.filter(
    (q) => (q.status === "ready" || q.status === "waiting") && (q.doctorId === null || q.doctorId === doctorId),
  );
  const rank = (q: QueueItem) => (q.isEmergency ? 0 : q.status === "ready" ? 1 : 2);
  // listQueue is already in queue order; a stable sort keeps it within a rank.
  return [...mine].sort((a, b) => rank(a) - rank(b))[0];
}

export async function callNext(tx: Tx, clinicId: string, doctorId: string, today: string) {
  const next = pickNext(await listQueue(tx, today), doctorId);
  if (!next) throw new AppError("Nobody is waiting for you right now.");
  return callPatient(tx, clinicId, next.id, doctorId, today);
}

export type ClinicalQueueItem = QueueItem & { encounterId: string | null };

/** Today's queue with each visit's consultation (if it has one). */
export async function listClinicalQueue(tx: Tx, today: string): Promise<ClinicalQueueItem[]> {
  const queue = await listQueue(tx, today);
  if (queue.length === 0) return [];
  const rows = await tx
    .select({ id: encounters.id, visitId: encounters.visitId })
    .from(encounters)
    .where(inArray(encounters.visitId, queue.map((q) => q.id)));
  const byVisit = new Map(rows.map((r) => [r.visitId, r.id]));
  return queue.map((q) => ({ ...q, encounterId: byVisit.get(q.id) ?? null }));
}

/** Patients this doctor finished today. */
export async function countSeenToday(tx: Tx, doctorId: string, today: string) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(visits)
    .where(and(eq(visits.visitDate, today), eq(visits.status, "completed"), eq(visits.doctorId, doctorId)));
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// The consultation itself
// ---------------------------------------------------------------------------

async function requireEncounter(tx: Tx, id: string) {
  const [row] = await tx.select().from(encounters).where(eq(encounters.id, id)).limit(1);
  if (!row) throw new AppError("Consultation not found.");
  return row;
}

export async function requireOpenEncounter(tx: Tx, id: string) {
  const row = await requireEncounter(tx, id);
  if (row.status !== "open") throw new AppError("This consultation is finalised. Add an amendment instead.");
  return row;
}

const NOT_YOURS = "This consultation belongs to another doctor. Take it over first if you are continuing it.";

/**
 * Open, and either unclaimed or this doctor's: notes, diagnoses, prescribing,
 * lab orders and signing are the consulting doctor's alone. (Vitals and
 * allergies stay open to the whole care team.)
 */
export async function requireOwnOpenEncounter(tx: Tx, id: string, userId: string) {
  const row = await requireOpenEncounter(tx, id);
  if (row.doctorId && row.doctorId !== userId) throw new AppError(NOT_YOURS);
  return row;
}

/** Another doctor continues an open consultation (audited by the caller). */
export async function takeOverEncounter(tx: Tx, id: string, userId: string) {
  const [row] = await tx.select().from(encounters).where(eq(encounters.id, id)).for("update").limit(1);
  if (!row) throw new AppError("Consultation not found.");
  if (row.status !== "open") throw new AppError("This consultation is finalised.");
  if (row.doctorId === userId) return { patientId: row.patientId, previousDoctorId: row.doctorId, changed: false };
  await tx.update(encounters).set({ doctorId: userId, updatedAt: new Date() }).where(eq(encounters.id, id));
  await tx.update(visits).set({ doctorId: userId, updatedAt: new Date() }).where(eq(visits.id, row.visitId));
  return { patientId: row.patientId, previousDoctorId: row.doctorId, changed: true };
}

export async function getEncounterCore(tx: Tx, id: string, today: string) {
  const [row] = await tx
    .select({ encounter: encounters, visit: visits, patient: patients })
    .from(encounters)
    .innerJoin(visits, eq(visits.id, encounters.visitId))
    .innerJoin(patients, eq(patients.id, encounters.patientId))
    .where(eq(encounters.id, id))
    .limit(1);
  if (!row) return null;

  const people = await tx
    .select({
      id: users.id,
      title: users.title,
      firstName: users.firstName,
      lastName: users.lastName,
      registrationNumber: users.registrationNumber,
      registrationCouncil: users.registrationCouncil,
      specialty: users.specialty,
    })
    .from(users)
    .where(inArray(users.id, [row.encounter.doctorId, row.encounter.finalizedBy].filter((v): v is string => Boolean(v))));
  const byId = new Map(people.map((p) => [p.id, p]));
  const doctor = row.encounter.doctorId ? byId.get(row.encounter.doctorId) : undefined;
  const finalizer = row.encounter.finalizedBy ? byId.get(row.encounter.finalizedBy) : undefined;

  return {
    encounter: row.encounter,
    visit: row.visit,
    patient: { ...row.patient, name: displayPatientName(row.patient), age: ageOn(row.patient, today) },
    doctor: doctor ? { ...doctor, name: staffName(doctor) } : null,
    finalizedByName: finalizer ? staffName(finalizer) : null,
  };
}

export async function saveNotes(
  tx: Tx,
  encounterId: string,
  input: { chiefComplaint?: string; history?: string; examination?: string; plan?: string; followUp?: string },
  userId: string,
) {
  const [row] = await tx
    .update(encounters)
    .set({
      chiefComplaint: input.chiefComplaint ?? null,
      history: input.history ?? null,
      examination: input.examination ?? null,
      plan: input.plan ?? null,
      followUp: input.followUp ?? null,
      doctorId: sql`coalesce(${encounters.doctorId}, ${userId}::uuid)`,
      updatedAt: new Date(),
    })
    .where(and(eq(encounters.id, encounterId), eq(encounters.status, "open"), or(isNull(encounters.doctorId), eq(encounters.doctorId, userId))))
    .returning({ id: encounters.id, patientId: encounters.patientId });
  if (!row) {
    const current = await requireOpenEncounter(tx, encounterId);
    if (current.doctorId && current.doctorId !== userId) throw new AppError(NOT_YOURS);
    throw new AppError("This consultation is finalised. Add an amendment instead.");
  }
  return row;
}

export type SignedPrescriptionSnapshot = {
  clinic: {
    name: string;
    addressLine: string | null;
    city: string | null;
    phone: string | null;
    email: string | null;
    letterheadText: string | null;
    footerText: string | null;
  };
  prescriber: { name: string; specialty: string | null; registrationNumber: string; registrationCouncil: string | null };
  patient: { name: string; mrn: string; age: number | null; sex: string };
  diagnoses: { code: string; label: string }[];
  items: {
    drugName: string;
    genericName: string;
    form: string;
    strength: string | null;
    dose: string;
    frequency: string;
    durationDays: number | null;
    instructions: string | null;
    quantity: number | null;
  }[];
  advice: string | null;
  followUp: string | null;
  signedAt: string;
  timezone: string;
};

/**
 * Sign & finalise. The signer must have a registration number on file. Any
 * prescription is signed with a snapshot of everything printed on it; the
 * consultation, its vitals, diagnoses and prescription then become immutable
 * (database triggers), and the visit is completed.
 */
export async function finalizeEncounter(tx: Tx, encounterId: string, signerId: string, today: string) {
  const [locked] = await tx.select().from(encounters).where(eq(encounters.id, encounterId)).for("update").limit(1);
  if (!locked) throw new AppError("Consultation not found.");
  if (locked.status !== "open") throw new AppError("This consultation is already finalised.");
  if (locked.doctorId && locked.doctorId !== signerId) throw new AppError(NOT_YOURS);

  const [signer] = await tx.select().from(users).where(eq(users.id, signerId)).limit(1);
  if (!signer?.registrationNumber?.trim()) {
    throw new AppError("Your medical registration number is not on file, so you cannot sign. Ask your Clinic Admin to add it to your profile.");
  }

  const core = await getEncounterCore(tx, encounterId, today);
  if (!core) throw new AppError("Consultation not found.");

  const now = new Date();
  let prescriptionId: string | null = null;
  const [draft] = await tx.select().from(prescriptions).where(eq(prescriptions.encounterId, encounterId)).limit(1);
  if (draft) {
    const items = await tx
      .select()
      .from(prescriptionItems)
      .where(eq(prescriptionItems.prescriptionId, draft.id))
      .orderBy(asc(prescriptionItems.sortOrder), asc(prescriptionItems.createdAt));
    if (items.length === 0) {
      await tx.delete(prescriptions).where(eq(prescriptions.id, draft.id));
    } else {
      const [settings] = await tx.select().from(clinicSettings).limit(1);
      const dx = await tx
        .select({ code: diagnoses.code, label: diagnoses.label })
        .from(diagnoses)
        .where(eq(diagnoses.encounterId, encounterId))
        .orderBy(desc(diagnoses.isPrimary), asc(diagnoses.createdAt));
      const snapshot: SignedPrescriptionSnapshot = {
        clinic: {
          name: settings?.displayName ?? "",
          addressLine: settings?.addressLine ?? null,
          city: settings?.city ?? null,
          phone: settings?.phone ?? null,
          email: settings?.email ?? null,
          letterheadText: settings?.letterheadText ?? null,
          footerText: settings?.footerText ?? null,
        },
        prescriber: {
          name: staffName(signer),
          specialty: signer.specialty,
          registrationNumber: signer.registrationNumber!,
          registrationCouncil: signer.registrationCouncil,
        },
        patient: { name: core.patient.name, mrn: core.patient.mrn, age: core.patient.age, sex: core.patient.sex },
        diagnoses: dx,
        items: items.map((i) => ({
          drugName: i.drugName,
          genericName: i.genericName,
          form: i.form,
          strength: i.strength,
          dose: i.dose,
          frequency: i.frequency,
          durationDays: i.durationDays,
          instructions: i.instructions,
          quantity: i.quantity,
        })),
        advice: locked.plan,
        followUp: locked.followUp,
        signedAt: now.toISOString(),
        timezone: settings?.timezone ?? "UTC",
      };
      await tx
        .update(prescriptions)
        .set({ status: "signed", prescriberId: signerId, signedSnapshot: snapshot, signedAt: now, updatedAt: now })
        .where(eq(prescriptions.id, draft.id));
      prescriptionId = draft.id;
    }
  }

  await tx
    .update(encounters)
    .set({ status: "finalized", finalizedAt: now, finalizedBy: signerId, doctorId: sql`coalesce(${encounters.doctorId}, ${signerId}::uuid)`, updatedAt: now })
    .where(eq(encounters.id, encounterId));

  const [visit] = await tx
    .update(visits)
    .set({ status: "completed", completedAt: now, updatedAt: now })
    .where(and(eq(visits.id, locked.visitId), inArray(visits.status, ["waiting", "in_triage", "ready", "with_doctor"])))
    .returning({ appointmentId: visits.appointmentId });
  if (visit?.appointmentId) {
    await tx
      .update(appointments)
      .set({ status: "completed", updatedAt: now })
      .where(and(eq(appointments.id, visit.appointmentId), eq(appointments.status, "checked_in")));
  }

  return { patientId: locked.patientId, prescriptionId };
}

export async function addAmendment(tx: Tx, clinicId: string, encounterId: string, text: string, authorId: string) {
  const encounter = await requireEncounter(tx, encounterId);
  if (encounter.status !== "finalized") throw new AppError("The consultation is still open: edit the notes directly.");
  const [row] = await tx
    .insert(encounterAmendments)
    .values({ clinicId, encounterId, authorId, text })
    .returning({ id: encounterAmendments.id });
  return { id: row.id, patientId: encounter.patientId };
}

export async function listAmendments(tx: Tx, encounterId: string) {
  const rows = await tx
    .select({ amendment: encounterAmendments, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(encounterAmendments)
    .innerJoin(users, eq(users.id, encounterAmendments.authorId))
    .where(eq(encounterAmendments.encounterId, encounterId))
    .orderBy(asc(encounterAmendments.createdAt));
  return rows.map((r) => ({ ...r.amendment, authorName: staffName(r) }));
}

/** The viewer's own private note (RLS hides everyone else's). */
export async function getPrivateNote(tx: Tx, encounterId: string) {
  const [row] = await tx.select().from(privateNotes).where(eq(privateNotes.encounterId, encounterId)).limit(1);
  return row ?? null;
}

export async function savePrivateNote(tx: Tx, clinicId: string, encounterId: string, text: string | undefined, authorId: string) {
  await requireEncounter(tx, encounterId);
  if (!text) {
    await tx.delete(privateNotes).where(and(eq(privateNotes.encounterId, encounterId), eq(privateNotes.authorId, authorId)));
    return;
  }
  await tx
    .insert(privateNotes)
    .values({ clinicId, encounterId, authorId, text })
    .onConflictDoUpdate({
      target: [privateNotes.encounterId, privateNotes.authorId],
      set: { text, updatedAt: new Date() },
    });
}

export type EncounterHistoryItem = {
  id: string;
  status: string;
  openedAt: Date;
  finalizedAt: Date | null;
  doctorName: string | null;
  chiefComplaint: string | null;
  diagnoses: string[];
};

export async function listPatientEncounters(tx: Tx, patientId: string, limit = 30): Promise<EncounterHistoryItem[]> {
  const rows = await tx
    .select({ encounter: encounters, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(encounters)
    .leftJoin(users, eq(users.id, encounters.doctorId))
    .where(eq(encounters.patientId, patientId))
    .orderBy(desc(encounters.openedAt))
    .limit(limit);
  if (rows.length === 0) return [];
  const dx = await tx
    .select({ encounterId: diagnoses.encounterId, code: diagnoses.code, label: diagnoses.label })
    .from(diagnoses)
    .where(inArray(diagnoses.encounterId, rows.map((r) => r.encounter.id)))
    .orderBy(desc(diagnoses.isPrimary), asc(diagnoses.createdAt));
  return rows.map((r) => ({
    id: r.encounter.id,
    status: r.encounter.status,
    openedAt: r.encounter.openedAt,
    finalizedAt: r.encounter.finalizedAt,
    doctorName: r.firstName ? staffName({ title: r.title, firstName: r.firstName, lastName: r.lastName ?? "" }) : null,
    chiefComplaint: r.encounter.chiefComplaint,
    diagnoses: dx.filter((d) => d.encounterId === r.encounter.id).map((d) => `${d.code} ${d.label}`),
  }));
}
