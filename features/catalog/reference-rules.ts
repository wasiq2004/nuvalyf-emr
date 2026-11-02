// Pure rules for the shared Indian medicine reference list (unit tested).
// Each source row has a brand name, manufacturer, MRP per pack, a pack label
// such as "strip of 10 tablets" or "bottle of 100 ml Syrup", and up to two
// composition parts such as "Amoxycillin  (500mg)". These become the fields a
// clinic item needs: form, units per pack, generic name and strength.
import type { DrugForm } from "./catalog-options";
import { normalizeItemName } from "./item-rules";

export type ReferenceSourceRow = {
  id: string;
  name: string;
  price: string;
  discontinued: string;
  manufacturer: string;
  packLabel: string;
  composition1: string;
  composition2: string;
};

export type ReferenceMedicine = {
  sourceId: number;
  name: string;
  normalized: string;
  manufacturer: string | null;
  composition: string | null;
  genericName: string;
  strength: string | null;
  form: DrugForm;
  packLabel: string;
  packSize: number;
  mrp: string | null;
  discontinued: boolean;
};

/** Form from the pack label's wording; the first rule that matches wins. */
const FORM_RULES: [RegExp, DrugForm][] = [
  [/\b(inhalers?|rotacaps?|respules?|transcaps?|inhalation|nebuli[sz]ers?|nasal sprays?|sprays?)\b/, "inhaler"],
  [/\b(injections?|infusions?|vials?|ampoules?|prefilled)\b/, "injection"],
  [/\bcapsules?\b/, "capsule"],
  [/\b(tablets?|lozenges?)\b/, "tablet"],
  [/\bdrops?\b/, "drops"],
  [/\bsuspensions?\b/, "suspension"],
  [/\b(syrups?|expectorants?|elixirs?|linctus|oral solution|tonics?)\b/, "syrup"],
  [/\bointments?\b/, "ointment"],
  [/\bcreams?\b/, "cream"],
  [/\bgels?\b/, "gel"],
  [/\b(sachets?|granules|powder)\b/, "sachet"],
];

export function formFromLabel(label: string): DrugForm {
  const l = label.toLowerCase();
  return FORM_RULES.find(([re]) => re.test(l))?.[1] ?? "other";
}

/**
 * Units in a pack. "strip of 10 tablets" -> 10, "box of 5 injection" -> 5.
 * Measured packs ("bottle of 100 ml", "tube of 15 gm") sell whole: 1.
 */
export function packSizeFromLabel(label: string): number {
  const m = /\bof\s+(\d+(?:\.\d+)?)\s*([a-z]*)/i.exec(label);
  if (!m) return 1;
  const unit = m[2].toLowerCase();
  if (["ml", "gm", "g", "kg", "l", "ltr", "litre", "mg", "mcg"].includes(unit)) return 1;
  const n = Math.round(Number(m[1]));
  return Number.isFinite(n) && n >= 1 && n <= 10000 ? n : 1;
}

/** "Amoxycillin  (500mg) " -> { name: "Amoxycillin", strength: "500mg" } */
export function parseComposition(part: string): { name: string; strength: string | null } | null {
  const text = part.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(text);
  if (!m) return { name: text, strength: null };
  return { name: m[1].trim() || text, strength: m[2].trim() || null };
}

export function toReferenceMedicine(row: ReferenceSourceRow): ReferenceMedicine | null {
  const sourceId = Number(row.id);
  const name = row.name.replace(/\s+/g, " ").trim().slice(0, 160);
  const normalized = normalizeItemName(name);
  if (!Number.isInteger(sourceId) || !normalized) return null;

  const parts = [parseComposition(row.composition1), parseComposition(row.composition2)].filter((p): p is NonNullable<typeof p> => p !== null);
  const genericName = parts.length ? parts.map((p) => p.name).join(" + ") : name;
  const strengths = parts.map((p) => p.strength).filter((s): s is string => Boolean(s));
  const price = Number(row.price);
  const packLabel = row.packLabel.replace(/\s+/g, " ").trim();

  return {
    sourceId,
    name,
    normalized: normalized.slice(0, 160),
    manufacturer: row.manufacturer.replace(/\s+/g, " ").trim().slice(0, 120) || null,
    composition: [row.composition1, row.composition2].map((c) => c.replace(/\s+/g, " ").trim()).filter(Boolean).join(" + ").slice(0, 300) || null,
    genericName: genericName.slice(0, 200),
    strength: strengths.length ? strengths.join(" + ").slice(0, 60) : null,
    form: formFromLabel(packLabel),
    packLabel: packLabel.slice(0, 100),
    packSize: packSizeFromLabel(packLabel),
    mrp: Number.isFinite(price) && price > 0 && price < 1e8 ? price.toFixed(2) : null,
    discontinued: row.discontinued.trim().toUpperCase() === "TRUE",
  };
}
