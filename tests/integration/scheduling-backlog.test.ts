// Phase 10 backlog: one-step rescheduling and doctor leave days.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ownerSql } from "./test-db";
import { createTestClinic } from "./fixtures";
import { withClinic } from "@/lib/db";
import { createStaff } from "@/features/staff/staff.service";
import { createService } from "@/features/scheduling/services.service";
import { replaceDoctorSchedule } from "@/features/scheduling/schedules.service";
import { registerPatient } from "@/features/patients/patients.service";
import { addLeave, bookAppointment, getAvailableSlots, removeLeave, rescheduleAppointment } from "@/features/scheduling/booking.service";
import { addDaysToDateString, todayInTimeZone } from "@/lib/time";

const TZ = "Asia/Kolkata";
const owner = ownerSql();
const today = todayInTimeZone(TZ);
const day = addDaysToDateString(today, 5);
const leaveDay = addDaysToDateString(today, 6);

let clinic: Awaited<ReturnType<typeof createTestClinic>>;
let adminId: string;
let doctorId: string;
let serviceId: string;
const patients: string[] = [];

const run = <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic({ clinicId: clinic.clinicId, userId: adminId }, fn);
const book = (patientId: string, date: string, time: string) =>
  run((tx) => bookAppointment(tx, clinic.clinicId, { patientId, doctorId, serviceId, date, time, timeZone: TZ, gridMinutes: 15 }, adminId));
const slots = (date: string) => run((tx) => getAvailableSlots(tx, { doctorId, serviceId, date, timeZone: TZ, gridMinutes: 15 }));

beforeAll(async () => {
  clinic = await createTestClinic("backlog");
  const [admin] = await owner`select id from app.users where clinic_id = ${clinic.clinicId}`;
  adminId = admin.id;
  doctorId = (await run((tx) => createStaff(tx, clinic.clinicId, { firstName: "Lea", lastName: "Ve", email: "lea@backlog.test", roleKeys: ["doctor"] }, adminId))).id;
  serviceId = (await run((tx) => createService(tx, clinic.clinicId, { name: "Consult", durationMinutes: 15, price: 300, isActive: true }))).id;
  await run((tx) =>
    replaceDoctorSchedule(tx, clinic.clinicId, doctorId, { windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "09:00", endTime: "10:00" })), serviceIds: [] }),
  );
  for (const name of ["Ria", "Sam"]) {
    patients.push((await run((tx) => registerPatient(tx, clinic.clinicId, { firstName: name, sex: "female", statedAgeYears: 30 }, { likelyIds: [], actorId: adminId, today }))).id);
  }
});

afterAll(async () => {
  await owner.end();
});

describe("rescheduling", () => {
  it("moves a booking in one step, and leaves it alone if the new slot is taken", async () => {
    const first = await book(patients[0], day, "09:00");
    await book(patients[1], day, "09:30");

    const moved = await run((tx) => rescheduleAppointment(tx, clinic.clinicId, first.id, { date: day, time: "09:15", timeZone: TZ, gridMinutes: 15 }, adminId));
    const [old] = await owner`select status, cancel_reason from app.appointments where id = ${first.id}`;
    expect(old).toEqual({ status: "cancelled", cancel_reason: `Rescheduled to ${day} 09:15` });
    expect((await slots(day)).map((s) => s.time)).toEqual(["09:00", "09:45"]);

    // Into a taken slot: refused, and the booking stays where it was.
    await expect(run((tx) => rescheduleAppointment(tx, clinic.clinicId, moved.id, { date: day, time: "09:30", timeZone: TZ, gridMinutes: 15 }, adminId))).rejects.toThrow();
    const [still] = await owner`select status from app.appointments where id = ${moved.id}`;
    expect(still.status).toBe("booked");
    await expect(run((tx) => rescheduleAppointment(tx, clinic.clinicId, first.id, { date: day, time: "09:45", timeZone: TZ, gridMinutes: 15 }, adminId))).rejects.toThrow(/cancelled appointment cannot be moved/);
  });
});

describe("leave days", () => {
  it("offer no slots, refuse bookings, and report clashing appointments", async () => {
    await book(patients[0], leaveDay, "09:00");
    const result = await run((tx) => addLeave(tx, clinic.clinicId, { doctorId, date: leaveDay, reason: "Conference", timeZone: TZ }, adminId));
    expect(result.affected).toBe(1);
    expect(await slots(leaveDay)).toEqual([]);
    await expect(book(patients[1], leaveDay, "09:30")).rejects.toThrow(/away on .* \(Conference\)/);
    await expect(run((tx) => addLeave(tx, clinic.clinicId, { doctorId, date: leaveDay, reason: "Again", timeZone: TZ }, adminId))).rejects.toThrow(/already marked/);

    const [row] = await owner`select id from app.schedule_exceptions where doctor_id = ${doctorId}`;
    await run((tx) => removeLeave(tx, row.id));
    expect((await slots(leaveDay)).length).toBeGreaterThan(0);
  });
});
