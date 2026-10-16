// Fixed option lists for the catalogue screens (shared by forms and actions).
import { VITAL_FIELDS } from "@/features/clinical/vital-rules";

export const DRUG_FORMS = [
  "tablet",
  "capsule",
  "syrup",
  "suspension",
  "injection",
  "ointment",
  "cream",
  "drops",
  "inhaler",
  "sachet",
  "gel",
  "other",
] as const;

export const SEVERITIES = ["minor", "moderate", "major", "contraindicated"] as const;

export const PRESET_KINDS = ["frequency", "duration", "instruction"] as const;

export const PRESET_KIND_LABELS: Record<(typeof PRESET_KINDS)[number], string> = {
  frequency: "Frequency",
  duration: "Duration (days)",
  instruction: "Instruction",
};

export const VITAL_KEYS = VITAL_FIELDS.map((f) => f.key) as [
  (typeof VITAL_FIELDS)[number]["key"],
  ...(typeof VITAL_FIELDS)[number]["key"][],
];

export const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
