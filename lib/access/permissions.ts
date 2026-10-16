// Permission catalogue. Code checks permissions, never role names.
//
// `module`     - the permission only takes effect if the clinic has that module
// `adjustable` - a Clinic Admin may grant/revoke it on roles; non-adjustable
//                permissions are fixed to the system role defaults (safety rules
//                such as "only doctors sign prescriptions")
import type { ModuleKey } from "./modules";

type PermissionDef = {
  label: string;
  group: string;
  module?: ModuleKey;
  adjustable: boolean;
};

export const PERMISSIONS = {
  // Patients & front desk
  "patient:read": { label: "View patient records (demographics)", group: "Patients", adjustable: true },
  "patient:write": { label: "Register and update patients", group: "Patients", adjustable: true },
  "emergency:admit": { label: "Admit an emergency", group: "Patients", adjustable: true },
  "appointment:read": { label: "View appointments", group: "Appointments", adjustable: true },
  "appointment:manage": { label: "Book, move and cancel appointments", group: "Appointments", adjustable: true },
  "queue:read": { label: "View the queue", group: "Queue", adjustable: true },
  "queue:checkin": { label: "Check patients in", group: "Queue", adjustable: true },
  "queue:call": { label: "Call / pick up patients from the queue", group: "Queue", adjustable: false },

  // Clinical
  "encounter:read": { label: "Read the clinical record", group: "Clinical", adjustable: false },
  "encounter:write": { label: "Write consultations", group: "Clinical", adjustable: false },
  "encounter:finalize": { label: "Finalise consultations", group: "Clinical", adjustable: false },
  "vitals:write": { label: "Record vitals", group: "Clinical", adjustable: false },
  "allergy:write": { label: "Record allergies", group: "Clinical", adjustable: false },
  "prescription:sign": { label: "Sign prescriptions", group: "Clinical", adjustable: false },

  // Lab
  "lab:order": { label: "Order lab tests", group: "Lab", module: "lab", adjustable: false },
  "lab:result": { label: "Enter lab results", group: "Lab", module: "lab", adjustable: false },

  // Pharmacy
  "pharmacy:dispense": { label: "Dispense prescriptions", group: "Pharmacy", module: "pharmacy", adjustable: false },
  "pharmacy:sell": { label: "Ring up pharmacy sales", group: "Pharmacy", module: "pharmacy", adjustable: true },
  "stock:manage": { label: "Manage stock and batches", group: "Pharmacy", module: "pharmacy", adjustable: true },
  "purchase:create": { label: "Raise purchase orders", group: "Pharmacy", module: "pharmacy", adjustable: true },
  "purchase:approve": { label: "Approve purchase orders", group: "Pharmacy", module: "pharmacy", adjustable: true },
  "medicine:manage": { label: "Edit the medicine list", group: "Pharmacy", adjustable: true },

  // Billing
  "billing:read": { label: "View invoices and payments", group: "Billing", adjustable: true },
  "billing:manage": { label: "Raise invoices and take payments", group: "Billing", adjustable: true },

  // Administration
  "settings:manage": { label: "Manage clinic settings", group: "Administration", adjustable: false },
  "staff:manage": { label: "Manage staff accounts and roles", group: "Administration", adjustable: false },
  "catalog:manage": { label: "Edit clinical catalogues (interactions, presets, ranges)", group: "Administration", adjustable: true },
  "import:run": { label: "Import patient registers", group: "Administration", adjustable: true },
  "broadcast:send": { label: "Send WhatsApp broadcasts", group: "Administration", module: "whatsapp", adjustable: true },
  "reports:read": { label: "View reports", group: "Administration", module: "reports", adjustable: true },

  // Analytics & compliance
  "analytics:read": { label: "View de-identified analytics", group: "Analytics", module: "analytics", adjustable: true },
  "analytics:manage": { label: "Build cohorts and exports", group: "Analytics", module: "analytics", adjustable: true },
  "audit:read": { label: "Read the audit trail", group: "Compliance", adjustable: false },
} as const satisfies Record<string, PermissionDef>;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return value in PERMISSIONS;
}

/**
 * Effective permissions: what the user's roles grant, minus anything whose
 * module the clinic does not have.
 */
export function resolvePermissions(
  granted: Iterable<string>,
  enabledModules: ReadonlySet<ModuleKey>,
): Set<Permission> {
  const result = new Set<Permission>();
  for (const value of granted) {
    if (!isPermission(value)) continue;
    const def: PermissionDef = PERMISSIONS[value];
    if (def.module && !enabledModules.has(def.module)) continue;
    result.add(value);
  }
  return result;
}
