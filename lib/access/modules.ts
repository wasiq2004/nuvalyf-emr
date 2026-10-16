// Optional product modules. A clinic's plan decides which are on.
// Core features (patients, appointments, queue, consultations, prescriptions,
// billing, audit) are always available and are not listed here.

export const MODULE_KEYS = ["pharmacy", "lab", "whatsapp", "reports", "analytics", "patient_portal"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

type ModuleDef = {
  name: string;
  description: string;
  /** Modules that must also be on. */
  requires: ModuleKey[];
  /** False = not assignable to any plan (e.g. the hidden patient portal). */
  offered: boolean;
};

export const MODULES: Record<ModuleKey, ModuleDef> = {
  pharmacy: {
    name: "Pharmacy",
    description: "Prescription queue, dispensing, stock, purchase orders",
    requires: [],
    offered: true,
  },
  lab: {
    name: "Lab",
    description: "Lab orders and results, Lab Technician role",
    requires: [],
    offered: true,
  },
  whatsapp: {
    name: "WhatsApp messaging",
    description: "Appointment reminders and consent-gated broadcasts",
    requires: [],
    offered: true,
  },
  reports: {
    name: "Reports",
    description: "Collections, outstanding payments, visit volume",
    requires: [],
    offered: true,
  },
  analytics: {
    name: "Analytics",
    description: "De-identified cohorts, data quality and exports",
    requires: ["reports"],
    offered: true,
  },
  patient_portal: {
    name: "Patient portal",
    description: "Patient sign-in and self-booking (not available yet)",
    requires: [],
    // Decision D1: kept hidden. Not assignable to any plan until re-enabled.
    offered: false,
  },
};
export const OFFERED_MODULE_KEYS = MODULE_KEYS.filter((key) => MODULES[key].offered);

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

/**
 * Validates a plan's module selection. Returns a user-facing problem, or null.
 */
export function validateModuleSelection(selected: readonly string[]): string | null {
  for (const key of selected) {
    if (!isModuleKey(key)) return `Unknown module "${key}"`;
    if (!MODULES[key].offered) return `${MODULES[key].name} is not available yet`;
    for (const dependency of MODULES[key].requires) {
      if (!selected.includes(dependency)) {
        return `${MODULES[key].name} requires ${MODULES[dependency].name}`;
      }
    }
  }
  return null;
}
