// Default system roles, copied into every clinic at onboarding. Derived from
// the role flow diagrams: each role holds only what its job needs.
import type { ModuleKey } from "./modules";
import type { Permission } from "./permissions";

export type SystemRoleKey =
  | "clinic_admin"
  | "receptionist"
  | "nurse"
  | "doctor"
  | "pharmacist"
  | "lab_tech"
  | "analyst"
  | "auditor";

type RoleTemplate = {
  name: string;
  description: string;
  /** Panel the role lands in after sign-in. */
  home: string;
  /** The home only exists with this module; otherwise the role lands on /today. */
  homeModule?: ModuleKey;
  permissions: Permission[];
};

export const SYSTEM_ROLES: Record<SystemRoleKey, RoleTemplate> = {
  clinic_admin: {
    name: "Clinic Admin",
    description: "Runs the practice. Reads the clinical record but cannot author it.",
    home: "/today",
    permissions: [
      "patient:read",
      "patient:write",
      "emergency:admit",
      "appointment:read",
      "appointment:manage",
      "queue:read",
      "queue:checkin",
      "encounter:read",
      "billing:read",
      "billing:manage",
      "settings:manage",
      "staff:manage",
      "catalog:manage",
      "medicine:manage",
      "purchase:approve",
      "import:run",
      "broadcast:send",
      "reports:read",
      "audit:read",
    ],
  },
  receptionist: {
    name: "Receptionist",
    description: "Registers, books, checks in and takes payment. No clinical notes.",
    home: "/today",
    permissions: [
      "patient:read",
      "patient:write",
      "emergency:admit",
      "appointment:read",
      "appointment:manage",
      "queue:read",
      "queue:checkin",
      "billing:read",
      "billing:manage",
    ],
  },
  nurse: {
    name: "Nurse",
    description: "Triage: vitals and allergies before the consultation.",
    home: "/today",
    permissions: [
      "patient:read",
      "emergency:admit",
      "appointment:read",
      "queue:read",
      "queue:call",
      "encounter:read",
      "vitals:write",
      "allergy:write",
    ],
  },
  doctor: {
    name: "Doctor",
    description: "Consults and prescribes. Signing needs a registration number.",
    home: "/today",
    permissions: [
      "patient:read",
      "emergency:admit",
      "appointment:read",
      "queue:read",
      "queue:call",
      "encounter:read",
      "encounter:write",
      "encounter:finalize",
      "vitals:write",
      "allergy:write",
      "prescription:sign",
      "lab:order",
      "analytics:read",
    ],
  },
  pharmacist: {
    name: "Pharmacist",
    description: "Dispenses finalised prescriptions and runs the stock.",
    home: "/pharmacy",
    homeModule: "pharmacy",
    permissions: [
      "pharmacy:dispense",
      "pharmacy:sell",
      "stock:manage",
      "purchase:create",
      "medicine:manage",
    ],
  },
  lab_tech: {
    name: "Lab Technician",
    description: "Enters lab results for ordered tests.",
    home: "/lab",
    homeModule: "lab",
    permissions: ["lab:result"],
  },
  analyst: {
    name: "Analyst",
    description: "De-identified analytics only. No access to patient records.",
    home: "/analytics",
    homeModule: "analytics",
    permissions: ["analytics:read", "analytics:manage"],
  },
  auditor: {
    name: "Auditor",
    description: "Reviews who did what and when. Never sees clinical content.",
    home: "/audit",
    permissions: ["audit:read"],
  },
};

export const SYSTEM_ROLE_KEYS = Object.keys(SYSTEM_ROLES) as SystemRoleKey[];

export function isSystemRoleKey(value: string): value is SystemRoleKey {
  return value in SYSTEM_ROLES;
}

/** Landing page for a user holding these roles (first match in priority order). */
export function homeForRoles(roleKeys: readonly string[], modules: ReadonlySet<ModuleKey> = new Set()): string {
  const priority: SystemRoleKey[] = [
    "clinic_admin",
    "doctor",
    "nurse",
    "receptionist",
    "pharmacist",
    "lab_tech",
    "analyst",
    "auditor",
  ];
  for (const key of priority) {
    if (!roleKeys.includes(key)) continue;
    const role = SYSTEM_ROLES[key];
    return role.homeModule && !modules.has(role.homeModule) ? "/today" : role.home;
  }
  return "/today";
}
