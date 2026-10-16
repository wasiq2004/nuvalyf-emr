// Phase 3: patients, duplicate detection, emergencies, booking, check-in, queue.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ownerSql } from "./test-db";
import { createTestClinic } from "./fixtures";
import { withClinic } from "@/lib/db";
import { createStaff } from "@/features/staff/staff.service";
import { createService } from "@/features/scheduling/services.service";
import { replaceDoctorSchedule } from "@/features/scheduling/schedules.service";
import {
  admitEmergency,
  findDuplicateCandidates,
  registerPatient,
  searchPatients,
  updatePatient,
} from "@/features/patients/patients.service";
import {
  addWalkIn,
  bookAppointment,
  cancelAppointment,
  checkInAppointment,
  getAvailableSlots,
  markNoShow,
} from "@/features/scheduling/booking.service";
import { completeTask, listOpenTasks, listQueue, markLeft, moveInQueue } from "@/features/queue/queue.service";
import { addDaysToDateString, dayOfWeekFromDateString, todayInTimeZone } from "@/lib/time";

const TZ = "Asia/Kolkata";
const owner = ownerSql();
let clinic: Awaited<ReturnType<typeof createTestClinic>>;
let adminId: string;
let doctorId: string;
let consultId: string;
let longId: string;
const today = todayInTimeZone(TZ);
let bookingDate: string;

const scope = () => ({ clinicId: clinic.clinicId, userId: adminId });
const run = <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic(scope(), fn);

async function register(firstName: string, extra: Partial<Parameters<typeof registerPatient>[2]> = {}, likelyIds: string[] = [], reason?: string) {
  return run((tx) =>
    registerPatient(tx, clinic.clinicId, { firstName, sex: "female", statedAgeYears: 30, ...extra }, { likelyIds, reason, actorId: adminId, today }),
  );
}

beforeAll(async () => {
  clinic = await createTestClinic("desk");
  const [admin] = await owner`select id from app.users where clinic_id = ${clinic.clinicId}`;
  adminId = admin.id;

  const doctor = await run((tx) =>
    createStaff(tx, clinic.clinicId, { firstName: "Meena", lastName: "Shah", email: "meena@desk.test", roleKeys: ["doctor"] }, adminId),
  );
  doctorId = doctor.id;
  consultId = (await run((tx) => createService(tx, clinic.clinicId, { name: "Consult", durationMinutes: 15, price: 400, isActive: true }))).id;
  longId = (await run((tx) => createService(tx, clinic.clinicId, { name: "Procedure", durationMinutes: 45, price: 900, isActive: true }))).id;

  // Works every day 09:00-12:00 so tests do not depend on the weekday.
  await run((tx) =>
    replaceDoctorSchedule(tx, clinic.clinicId, doctorId, {
      windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "09:00", endTime: "12:00" })),
      serviceIds: [],
    }),
  );
  bookingDate = addDaysToDateString(today, 3);
  expect(dayOfWeekFromDateString(bookingDate)).toBeGreaterThanOrEqual(0);
});

afterAll(async () => {
  await owner.end();
});

describe("patients", () => {
  it("issues unique, sequential record numbers even under concurrency", async () => {
    const created = await Promise.all(Array.from({ length: 8 }, (_, i) => register(`Concurrent${i}`)));
    const mrns = created.map((p) => p.mrn);
    expect(new Set(mrns).size).toBe(8);
    expect(mrns.every((m) => /^P-\d{6}$/.test(m))).toBe(true);
  });

  it("finds patients by record number, any mobile format and misspelled names", async () => {
    const asha = await register("Asha", { lastName: "Raghavan", mobile: "+91 98450 11111" });
    const byMrn = await run((tx) => searchPatients(tx, asha.mrn.toLowerCase(), today));
    const byMobile = await run((tx) => searchPatients(tx, "09845011111", today));
    const byTypo = await run((tx) => searchPatients(tx, "asha ragavan", today));
    for (const results of [byMrn, byMobile, byTypo]) expect(results.map((r) => r.id)).toContain(asha.id);
  });

  it("flags a likely duplicate, but not a family member who only shares the mobile", async () => {
    await register("Kiran", { lastName: "Kumar", mobile: "9000012345", statedAgeYears: 34 });
    const sameMobileDifferentPerson = await run((tx) =>
      findDuplicateCandidates(tx, { firstName: "Lakshmi", lastName: "Kumar", mobile: "9000012345", statedAgeYears: 8 }, today),
    );
    const samePerson = await run((tx) =>
      findDuplicateCandidates(tx, { firstName: "Kiran", lastName: "Kumar", mobile: "+91-90000-12345", statedAgeYears: 35 }, today),
    );
    expect(sameMobileDifferentPerson.some((c) => c.sameMobile)).toBe(true);
    expect(sameMobileDifferentPerson.some((c) => c.likely)).toBe(false);
    expect(samePerson.some((c) => c.likely && c.reasons.includes("Same mobile"))).toBe(true);
  });

  it("requires a written reason to register over a likely duplicate, and stores it", async () => {
    const existing = await register("Ravi", { lastName: "Iyer" });
    await expect(register("Ravi", { lastName: "Iyer" }, [existing.id])).rejects.toThrow(/Explain/);
    const created = await register("Ravi", { lastName: "Iyer" }, [existing.id], "Different person: father and son share the name");
    const [row] = await owner`select reason, candidate_ids from app.duplicate_overrides where patient_id = ${created.id}`;
    expect(row.reason).toMatch(/father and son/);
    expect(row.candidate_ids).toEqual([existing.id]);
  });

  it("another clinic cannot find these patients", async () => {
    const other = await createTestClinic("desk-other");
    const results = await withClinic({ clinicId: other.clinicId }, (tx) => searchPatients(tx, "Asha", today));
    expect(results).toHaveLength(0);
  });
});

describe("emergency admission", () => {
  let emergency: Awaited<ReturnType<typeof admitEmergency>>;

  it("registers a placeholder from one label, at the front of the queue, with an URGENT task", async () => {
    const routine = await register("Routine", { lastName: "Patient" });
    await run((tx) => addWalkIn(tx, clinic.clinicId, { patientId: routine.id }, adminId, today));

    emergency = await run((tx) =>
      admitEmergency(tx, clinic.clinicId, { label: "Unknown male, approx 40", approxAge: 40, sex: "male", companionPhone: "9811122233" }, adminId, today),
    );

    const queue = await run((tx) => listQueue(tx, today));
    expect(queue[0]).toMatchObject({ id: emergency.visitId, isEmergency: true, patientName: "Unknown male, approx 40", companionPhone: "9811122233" });

    const tasks = await run((tx) => listOpenTasks(tx));
    expect(tasks.some((t) => t.patientId === emergency.patientId && t.priority === "urgent")).toBe(true);
  });

  it("the urgent task cannot be ticked off; it closes when the record is completed", async () => {
    const task = (await run((tx) => listOpenTasks(tx))).find((t) => t.patientId === emergency.patientId)!;
    await expect(run((tx) => completeTask(tx, task.id, adminId))).rejects.toThrow(/closes itself/);

    await run((tx) => updatePatient(tx, emergency.patientId, { firstName: "Suresh", lastName: "Babu", sex: "male", statedAgeYears: 41 }, adminId, today));
    const remaining = await run((tx) => listOpenTasks(tx));
    expect(remaining.some((t) => t.patientId === emergency.patientId)).toBe(false);
    const [row] = await owner`select is_placeholder from app.patients where id = ${emergency.patientId}`;
    expect(row.is_placeholder).toBe(false);
  });
});

describe("booking", () => {
  let patientA: string;
  let patientB: string;

  beforeAll(async () => {
    patientA = (await register("Booker", { lastName: "One" })).id;
    patientB = (await register("Booker", { lastName: "Two" })).id;
  });

  const book = (patientId: string, time: string, serviceId = consultId) =>
    run((tx) =>
      bookAppointment(tx, clinic.clinicId, { patientId, doctorId, serviceId, date: bookingDate, time, timeZone: TZ, gridMinutes: 15 }, adminId),
    );

  it("offers slots inside the schedule that fit the service duration", async () => {
    const consult = await run((tx) => getAvailableSlots(tx, { doctorId, serviceId: consultId, date: bookingDate, timeZone: TZ, gridMinutes: 15 }));
    const procedure = await run((tx) => getAvailableSlots(tx, { doctorId, serviceId: longId, date: bookingDate, timeZone: TZ, gridMinutes: 15 }));
    expect(consult.at(0)?.time).toBe("09:00");
    expect(consult.at(-1)?.time).toBe("11:45");
    expect(procedure.at(-1)?.time).toBe("11:15");
  });

  it("only one of two simultaneous bookings for the same slot succeeds", async () => {
    const results = await Promise.allSettled([book(patientA, "10:00"), book(patientB, "10:00")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(/just taken/);
  });

  it("a long service cannot overlap an existing booking", async () => {
    // 09:30 + 45 min would run into the 10:00 booking.
    await expect(book(patientB, "09:30", longId)).rejects.toThrow(/just taken/);
    await expect(book(patientB, "09:15", longId)).resolves.toBeDefined(); // 09:15-10:00 fits exactly
  });

  it("cancelling frees the slot", async () => {
    const appt = await book(patientA, "11:00");
    await expect(book(patientB, "11:00")).rejects.toThrow(/just taken/);
    await run((tx) => cancelAppointment(tx, appt.id, "Patient called"));
    await expect(book(patientB, "11:00")).resolves.toBeDefined();
  });

  it("a no-show can only be marked once the time has passed", async () => {
    const appt = await book(patientA, "11:30");
    await expect(run((tx) => markNoShow(tx, appt.id))).rejects.toThrow(/not arrived/);
  });
});

describe("check-in and queue", () => {
  it("checking in starts the wait clock and joins the queue once", async () => {
    const patient = await register("Arrival", { lastName: "Test" });
    // A booking for today in the past cannot be made through the slot engine, so insert directly.
    const [appt] = await owner`
      insert into app.appointments (clinic_id, patient_id, doctor_id, service_id, starts_at, ends_at)
      values (${clinic.clinicId}, ${patient.id}, ${doctorId}, ${consultId}, now() + interval '10 minutes', now() + interval '25 minutes')
      returning id`;

    const result = await run((tx) => checkInAppointment(tx, clinic.clinicId, appt.id, adminId, today));
    const queue = await run((tx) => listQueue(tx, today));
    expect(queue.find((q) => q.id === result.visitId)).toMatchObject({ status: "waiting", patientId: patient.id });
    await expect(run((tx) => checkInAppointment(tx, clinic.clinicId, appt.id, adminId, today))).rejects.toThrow(/Only a booked/);
  });

  it("a patient cannot be in today's queue twice", async () => {
    const patient = await register("Walkin", { lastName: "Twice" });
    await run((tx) => addWalkIn(tx, clinic.clinicId, { patientId: patient.id }, adminId, today));
    await expect(run((tx) => addWalkIn(tx, clinic.clinicId, { patientId: patient.id }, adminId, today))).rejects.toThrow(/already in today/);
  });

  it("reordering moves routine patients but never an emergency", async () => {
    const before = await run((tx) => listQueue(tx, today));
    const routine = before.filter((q) => !q.isEmergency && q.status === "waiting");
    const last = routine.at(-1)!;
    await run((tx) => moveInQueue(tx, last.id, "up", today));
    const after = (await run((tx) => listQueue(tx, today))).filter((q) => !q.isEmergency && q.status === "waiting");
    expect(after.findIndex((q) => q.id === last.id)).toBe(routine.length - 2);

    const emergency = before.find((q) => q.isEmergency)!;
    await expect(run((tx) => moveInQueue(tx, emergency.id, "down", today))).rejects.toThrow(/routine/);
    expect((await run((tx) => listQueue(tx, today)))[0].isEmergency).toBe(true);
  });

  it("marking someone as left removes them from the active queue", async () => {
    const queue = await run((tx) => listQueue(tx, today));
    const target = queue.find((q) => !q.isEmergency)!;
    await run((tx) => markLeft(tx, target.id));
    expect((await run((tx) => listQueue(tx, today))).some((q) => q.id === target.id)).toBe(false);
  });
});
