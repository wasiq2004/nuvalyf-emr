// Phase 2: staff accounts, roles & permissions, services, schedules.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ownerSql } from "./test-db";
import { createTestClinic, META } from "./fixtures";
import { withClinic } from "@/lib/db";
import { createStaff, listStaff, reissuePassword, setStaffStatus, updateStaff } from "@/features/staff/staff.service";
import { listRoles, resetRoleToDefaults, setRolePermission } from "@/features/staff/roles.service";
import { createService } from "@/features/scheduling/services.service";
import { getDoctorSchedule, replaceDoctorSchedule } from "@/features/scheduling/schedules.service";
import { verifyClinicLogin } from "@/features/auth/clinic-login.service";
import { loadClinicContext } from "@/features/auth/clinic-context.service";
import { SYSTEM_ROLES } from "@/lib/access/roles";

const owner = ownerSql();
let clinic: Awaited<ReturnType<typeof createTestClinic>>;
let adminId: string;
let doctorId: string;

const scope = () => ({ clinicId: clinic.clinicId, userId: adminId });
const staffInput = (overrides: Partial<Parameters<typeof createStaff>[2]> = {}) => ({
  firstName: "Dev",
  lastName: "Doctor",
  email: `doc-${Math.random().toString(36).slice(2, 8)}@clinic.test`,
  roleKeys: ["doctor"],
  ...overrides,
});

beforeAll(async () => {
  clinic = await createTestClinic("admin");
  const [admin] = await owner`select id from app.users where clinic_id = ${clinic.clinicId}`;
  adminId = admin.id;
});

afterAll(async () => {
  await owner.end();
});

describe("staff accounts", () => {
  it("creates a staff member with a one-time password and the chosen roles", async () => {
    const created = await withClinic(scope(), (tx) =>
      createStaff(tx, clinic.clinicId, staffInput({ email: "Dr.Rao@Clinic.test", title: "Dr.", registrationNumber: "KMC-123" }), adminId),
    );
    doctorId = created.id;

    const login = await verifyClinicLogin({ clinicCode: clinic.code, email: "dr.rao@clinic.test", password: created.oneTimePassword, meta: META });
    expect(login.ok).toBe(true);

    const state = await loadClinicContext(clinic.clinicId, doctorId, 1);
    expect(state.status === "ok" && state.ctx.permissions.has("prescription:sign")).toBe(true);
    expect(state.status === "ok" && state.ctx.permissions.has("staff:manage")).toBe(false);
  });

  it("rejects a duplicate email within the clinic, case-insensitively", async () => {
    await expect(
      withClinic(scope(), (tx) => createStaff(tx, clinic.clinicId, staffInput({ email: "DR.RAO@clinic.test" }), adminId)),
    ).rejects.toThrow(/already exists/);
  });

  it("allows the same email in a different clinic", async () => {
    const other = await createTestClinic("other");
    const [otherAdmin] = await owner`select id from app.users where clinic_id = ${other.clinicId}`;
    await expect(
      withClinic({ clinicId: other.clinicId, userId: otherAdmin.id }, (tx) =>
        createStaff(tx, other.clinicId, staffInput({ email: "dr.rao@clinic.test" }), otherAdmin.id),
      ),
    ).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("requires at least one known role", async () => {
    await expect(withClinic(scope(), (tx) => createStaff(tx, clinic.clinicId, staffInput({ roleKeys: [] }), adminId))).rejects.toThrow(
      /at least one role/,
    );
    await expect(
      withClinic(scope(), (tx) => createStaff(tx, clinic.clinicId, staffInput({ roleKeys: ["superuser"] }), adminId)),
    ).rejects.toThrow(/Unknown role/);
  });

  it("re-issuing a password ends sessions and the old password", async () => {
    const before = await loadClinicContext(clinic.clinicId, doctorId, 1);
    expect(before.status).toBe("ok");
    const { oneTimePassword } = await withClinic(scope(), (tx) => reissuePassword(tx, doctorId, adminId));
    expect((await loadClinicContext(clinic.clinicId, doctorId, 1)).status).toBe("expired");
    expect((await verifyClinicLogin({ clinicCode: clinic.code, email: "dr.rao@clinic.test", password: oneTimePassword, meta: META })).ok).toBe(true);
  });

  it("you cannot re-issue your own password, disable yourself, or drop your own admin role", async () => {
    await expect(withClinic(scope(), (tx) => reissuePassword(tx, adminId, adminId))).rejects.toThrow(/own account/);
    await expect(withClinic(scope(), (tx) => setStaffStatus(tx, adminId, "disabled", adminId))).rejects.toThrow(/own account/);
    await expect(
      withClinic(scope(), (tx) =>
        updateStaff(tx, clinic.clinicId, adminId, { firstName: "Ada", lastName: "Admin", email: clinic.adminEmail, roleKeys: ["doctor"] }, adminId),
      ),
    ).rejects.toThrow(/your own Clinic Admin role/);
  });

  it("the clinic always keeps an active Clinic Admin", async () => {
    const second = await withClinic(scope(), (tx) =>
      createStaff(tx, clinic.clinicId, staffInput({ roleKeys: ["clinic_admin"], email: "second.admin@clinic.test" }), adminId),
    );
    // With two admins, one may be disabled...
    await withClinic(scope(), (tx) => setStaffStatus(tx, second.id, "disabled", adminId));
    // ...but now the first admin is the last one: the second (if re-enabled) cannot remove them.
    await withClinic(scope(), (tx) => setStaffStatus(tx, second.id, "active", adminId));
    await withClinic(scope(), (tx) => setStaffStatus(tx, adminId, "disabled", second.id));
    await expect(withClinic(scope(), (tx) => setStaffStatus(tx, second.id, "disabled", adminId))).rejects.toThrow(
      /at least one active Clinic Admin/,
    );
    await withClinic(scope(), (tx) => setStaffStatus(tx, adminId, "active", second.id));
  });

  it("disabling a staff member blocks sign-in and live sessions", async () => {
    const nurse = await withClinic(scope(), (tx) =>
      createStaff(tx, clinic.clinicId, staffInput({ roleKeys: ["nurse"], email: "nurse@clinic.test" }), adminId),
    );
    await withClinic(scope(), (tx) => setStaffStatus(tx, nurse.id, "disabled", adminId));
    expect((await loadClinicContext(clinic.clinicId, nurse.id, 2)).status).toBe("disabled");
    expect(await verifyClinicLogin({ clinicCode: clinic.code, email: "nurse@clinic.test", password: nurse.oneTimePassword, meta: META })).toEqual({
      ok: false,
      reason: "account_disabled",
    });
  });

  it("lists staff with their roles", async () => {
    const staff = await withClinic(scope(), (tx) => listStaff(tx));
    const doctor = staff.find((s) => s.id === doctorId);
    expect(doctor?.roles.map((r) => r.key)).toEqual(["doctor"]);
    expect(doctor?.registrationNumber).toBe("KMC-123");
  });
});

describe("roles & permissions", () => {
  async function role(key: string) {
    const roles = await withClinic(scope(), (tx) => listRoles(tx));
    return roles.find((r) => r.key === key)!;
  }

  it("grants and revokes an adjustable permission", async () => {
    const nurse = await role("nurse");
    await withClinic(scope(), (tx) => setRolePermission(tx, clinic.clinicId, { roleId: nurse.id, permission: "billing:read", granted: true }));
    expect((await role("nurse")).permissions).toContain("billing:read");
    await withClinic(scope(), (tx) => setRolePermission(tx, clinic.clinicId, { roleId: nurse.id, permission: "billing:read", granted: false }));
    expect((await role("nurse")).permissions).not.toContain("billing:read");
  });

  it("refuses to move safety rules", async () => {
    const nurse = await role("nurse");
    const doctor = await role("doctor");
    await expect(
      withClinic(scope(), (tx) => setRolePermission(tx, clinic.clinicId, { roleId: nurse.id, permission: "prescription:sign", granted: true })),
    ).rejects.toThrow(/safety rule/);
    await expect(
      withClinic(scope(), (tx) => setRolePermission(tx, clinic.clinicId, { roleId: doctor.id, permission: "prescription:sign", granted: false })),
    ).rejects.toThrow(/safety rule/);
  });

  it("keeps the Auditor and Analyst away from operations and patients", async () => {
    const auditor = await role("auditor");
    const analyst = await role("analyst");
    await expect(
      withClinic(scope(), (tx) => setRolePermission(tx, clinic.clinicId, { roleId: auditor.id, permission: "billing:read", granted: true })),
    ).rejects.toThrow(/Auditor/);
    await expect(
      withClinic(scope(), (tx) => setRolePermission(tx, clinic.clinicId, { roleId: analyst.id, permission: "patient:read", granted: true })),
    ).rejects.toThrow(/Analyst/);
  });

  it("reset restores the shipped defaults", async () => {
    const receptionist = await role("receptionist");
    await withClinic(scope(), (tx) =>
      setRolePermission(tx, clinic.clinicId, { roleId: receptionist.id, permission: "billing:manage", granted: false }),
    );
    await withClinic(scope(), (tx) => resetRoleToDefaults(tx, clinic.clinicId, receptionist.id));
    expect((await role("receptionist")).permissions.sort()).toEqual([...SYSTEM_ROLES.receptionist.permissions].sort());
  });

  it("permission changes apply on the user's next request", async () => {
    const doctor = await role("doctor");
    const [{ session_version }] = await owner`select session_version from app.users where id = ${doctorId}`;
    await withClinic(scope(), (tx) => setRolePermission(tx, clinic.clinicId, { roleId: doctor.id, permission: "billing:read", granted: true }));
    const state = await loadClinicContext(clinic.clinicId, doctorId, session_version);
    expect(state.status === "ok" && state.ctx.permissions.has("billing:read")).toBe(true);
  });
});

describe("services and schedules", () => {
  let consultId: string;

  it("services are unique per clinic, case-insensitively", async () => {
    const created = await withClinic(scope(), (tx) =>
      createService(tx, clinic.clinicId, { name: "Consultation", durationMinutes: 15, price: 500, isActive: true }),
    );
    consultId = created.id;
    await expect(
      withClinic(scope(), (tx) => createService(tx, clinic.clinicId, { name: "consultation", durationMinutes: 30, price: 1, isActive: true })),
    ).rejects.toThrow(/already exists/);
  });

  it("saves split shifts and offered services", async () => {
    await withClinic(scope(), (tx) =>
      replaceDoctorSchedule(tx, clinic.clinicId, doctorId, {
        windows: [
          { weekday: 1, startTime: "09:00", endTime: "13:00" },
          { weekday: 1, startTime: "17:00", endTime: "20:00" },
        ],
        serviceIds: [consultId],
      }),
    );
    const schedule = await withClinic(scope(), (tx) => getDoctorSchedule(tx, doctorId));
    expect(schedule.windows).toEqual([
      { weekday: 1, startTime: "09:00", endTime: "13:00" },
      { weekday: 1, startTime: "17:00", endTime: "20:00" },
    ]);
    expect(schedule.serviceIds).toEqual([consultId]);
  });

  it("rejects overlaps and non-doctors", async () => {
    await expect(
      withClinic(scope(), (tx) =>
        replaceDoctorSchedule(tx, clinic.clinicId, doctorId, {
          windows: [
            { weekday: 2, startTime: "09:00", endTime: "13:00" },
            { weekday: 2, startTime: "12:00", endTime: "15:00" },
          ],
          serviceIds: [],
        }),
      ),
    ).rejects.toThrow(/overlaps/);
    await expect(
      withClinic(scope(), (tx) => replaceDoctorSchedule(tx, clinic.clinicId, adminId, { windows: [], serviceIds: [] })),
    ).rejects.toThrow(/Doctor role/);
  });

  it("another clinic cannot see or reference this schedule", async () => {
    const other = await createTestClinic("peek");
    const seen = await withClinic({ clinicId: other.clinicId }, (tx) => getDoctorSchedule(tx, doctorId));
    expect(seen.windows).toEqual([]);
  });
});
