// What each starter lab test reports: its parameters, units and reference
// ranges. Copied into a clinic's own catalogue, where the clinic's pathologist
// sets the ranges for their own analysers and methods. These are typical adult
// values to start from, not a clinical standard.

export type StarterRange = { sex?: "male" | "female"; ageMin?: number; ageMax?: number; low?: number; high?: number; criticalLow?: number; criticalHigh?: number };

export type StarterParameter = {
  key: string;
  name: string;
  section?: string;
  unit?: string;
  /** Results that are words, not numbers; `normal` marks the expected answer. */
  text?: boolean;
  normal?: string;
  ranges?: StarterRange[];
};

const n = (key: string, name: string, unit: string, ranges: StarterRange[], section?: string): StarterParameter => ({ key, name, unit, ranges, section });
const word = (key: string, name: string, normal?: string, section?: string, unit?: string): StarterParameter => ({ key, name, text: true, normal, section, unit });

/** Keyed by the starter lab test key (lib/catalog/starter.ts). */
export const STARTER_LAB_PARAMETERS: Record<string, StarterParameter[]> = {
  cbc: [
    n("hb", "Haemoglobin", "g/dL", [
      { sex: "male", low: 13, high: 17, criticalLow: 7, criticalHigh: 20 },
      { sex: "female", low: 12, high: 15, criticalLow: 7, criticalHigh: 20 },
    ]),
    n("rbc", "RBC count", "million/cumm", [
      { sex: "male", low: 4.5, high: 5.5 },
      { sex: "female", low: 3.8, high: 4.8 },
    ]),
    n("pcv", "PCV (haematocrit)", "%", [
      { sex: "male", low: 40, high: 50 },
      { sex: "female", low: 36, high: 46 },
    ]),
    n("mcv", "MCV", "fL", [{ low: 83, high: 101 }], "Red cell indices"),
    n("mch", "MCH", "pg", [{ low: 27, high: 32 }], "Red cell indices"),
    n("mchc", "MCHC", "g/dL", [{ low: 31.5, high: 34.5 }], "Red cell indices"),
    n("rdw", "RDW-CV", "%", [{ low: 11.6, high: 14 }], "Red cell indices"),
    n("tlc", "Total leucocyte count", "/cumm", [{ low: 4000, high: 11000, criticalLow: 2000, criticalHigh: 30000 }]),
    n("neut", "Neutrophils", "%", [{ low: 40, high: 80 }], "Differential count"),
    n("lymph", "Lymphocytes", "%", [{ low: 20, high: 40 }], "Differential count"),
    n("mono", "Monocytes", "%", [{ low: 2, high: 10 }], "Differential count"),
    n("eos", "Eosinophils", "%", [{ low: 1, high: 6 }], "Differential count"),
    n("baso", "Basophils", "%", [{ low: 0, high: 2 }], "Differential count"),
    n("plt", "Platelet count", "/cumm", [{ low: 150000, high: 410000, criticalLow: 20000, criticalHigh: 1000000 }]),
  ],
  hb: [
    n("hb", "Haemoglobin", "g/dL", [
      { sex: "male", low: 13, high: 17, criticalLow: 7, criticalHigh: 20 },
      { sex: "female", low: 12, high: 15, criticalLow: 7, criticalHigh: 20 },
    ]),
  ],
  esr: [
    n("esr", "ESR", "mm/hr", [
      { sex: "male", low: 0, high: 15 },
      { sex: "female", low: 0, high: 20 },
    ]),
  ],
  crp: [n("crp", "C-reactive protein", "mg/L", [{ high: 6 }])],
  fbs: [n("fbs", "Fasting blood sugar", "mg/dL", [{ low: 70, high: 99, criticalLow: 50, criticalHigh: 400 }])],
  ppbs: [n("ppbs", "Post-prandial blood sugar", "mg/dL", [{ high: 140, criticalLow: 50, criticalHigh: 400 }])],
  rbs: [n("rbs", "Random blood sugar", "mg/dL", [{ high: 140, criticalLow: 50, criticalHigh: 400 }])],
  hba1c: [n("hba1c", "HbA1c", "%", [{ high: 5.7 }])],
  lipid: [
    n("chol", "Total cholesterol", "mg/dL", [{ high: 200 }]),
    n("tg", "Triglycerides", "mg/dL", [{ high: 150 }]),
    n("hdl", "HDL cholesterol", "mg/dL", [{ sex: "male", low: 40 }, { sex: "female", low: 50 }]),
    n("ldl", "LDL cholesterol", "mg/dL", [{ high: 100 }]),
    n("vldl", "VLDL cholesterol", "mg/dL", [{ high: 30 }]),
    n("tc-hdl", "Total cholesterol / HDL ratio", "ratio", [{ high: 5 }]),
  ],
  lft: [
    n("tbil", "Total bilirubin", "mg/dL", [{ low: 0.3, high: 1.2 }], "Bilirubin"),
    n("dbil", "Direct bilirubin", "mg/dL", [{ low: 0, high: 0.3 }], "Bilirubin"),
    n("ibil", "Indirect bilirubin", "mg/dL", [{ low: 0.2, high: 0.9 }], "Bilirubin"),
    n("ast", "AST (SGOT)", "U/L", [{ low: 0, high: 40 }], "Enzymes"),
    n("alt", "ALT (SGPT)", "U/L", [{ low: 0, high: 41 }], "Enzymes"),
    n("alp", "Alkaline phosphatase", "U/L", [{ low: 40, high: 130 }], "Enzymes"),
    n("tp", "Total protein", "g/dL", [{ low: 6, high: 8.3 }], "Proteins"),
    n("alb", "Albumin", "g/dL", [{ low: 3.5, high: 5.2 }], "Proteins"),
    n("glob", "Globulin", "g/dL", [{ low: 2, high: 3.5 }], "Proteins"),
    n("ag", "A/G ratio", "ratio", [{ low: 1, high: 2.2 }], "Proteins"),
  ],
  kft: [
    n("urea", "Blood urea", "mg/dL", [{ low: 15, high: 45 }]),
    n("bun", "BUN", "mg/dL", [{ low: 7, high: 20 }]),
    n("creat", "Serum creatinine", "mg/dL", [
      { sex: "male", low: 0.7, high: 1.3 },
      { sex: "female", low: 0.5, high: 1.1 },
    ]),
    n("uric", "Serum uric acid", "mg/dL", [
      { sex: "male", low: 3.4, high: 7 },
      { sex: "female", low: 2.4, high: 6 },
    ]),
    n("na", "Sodium", "mmol/L", [{ low: 135, high: 145, criticalLow: 120, criticalHigh: 160 }], "Electrolytes"),
    n("k", "Potassium", "mmol/L", [{ low: 3.5, high: 5.1, criticalLow: 2.8, criticalHigh: 6.2 }], "Electrolytes"),
    n("cl", "Chloride", "mmol/L", [{ low: 98, high: 107 }], "Electrolytes"),
  ],
  creatinine: [
    n("creat", "Serum creatinine", "mg/dL", [
      { sex: "male", low: 0.7, high: 1.3 },
      { sex: "female", low: 0.5, high: 1.1 },
    ]),
  ],
  electrolytes: [
    n("na", "Sodium", "mmol/L", [{ low: 135, high: 145, criticalLow: 120, criticalHigh: 160 }]),
    n("k", "Potassium", "mmol/L", [{ low: 3.5, high: 5.1, criticalLow: 2.8, criticalHigh: 6.2 }]),
    n("cl", "Chloride", "mmol/L", [{ low: 98, high: 107 }]),
  ],
  "uric-acid": [
    n("uric", "Serum uric acid", "mg/dL", [
      { sex: "male", low: 3.4, high: 7 },
      { sex: "female", low: 2.4, high: 6 },
    ]),
  ],
  tsh: [n("tsh", "TSH", "µIU/mL", [{ low: 0.4, high: 4 }])],
  vitd: [n("vitd", "Vitamin D (25-OH)", "ng/mL", [{ low: 30, high: 100 }])],
  b12: [n("b12", "Vitamin B12", "pg/mL", [{ low: 200, high: 900 }])],
  "urine-routine": [
    word("colour", "Colour", "Pale yellow", "Physical"),
    word("appearance", "Appearance", "Clear", "Physical"),
    n("ph", "pH", "", [{ low: 4.6, high: 8 }], "Chemical"),
    n("sg", "Specific gravity", "", [{ low: 1.005, high: 1.03 }], "Chemical"),
    word("protein", "Protein", "Nil", "Chemical"),
    word("glucose", "Glucose", "Nil", "Chemical"),
    word("ketones", "Ketones", "Negative", "Chemical"),
    word("bilirubin", "Bilirubin", "Negative", "Chemical"),
    word("blood", "Blood", "Negative", "Chemical"),
    word("pus", "Pus cells", "0-5", "Microscopy", "/hpf"),
    word("rbc", "RBC", "Nil", "Microscopy", "/hpf"),
    word("epith", "Epithelial cells", "Few", "Microscopy", "/hpf"),
    word("casts", "Casts", "Nil", "Microscopy"),
    word("crystals", "Crystals", "Nil", "Microscopy"),
  ],
  "urine-hcg": [word("hcg", "Urine hCG")],
  widal: [word("to", "S. typhi O"), word("th", "S. typhi H"), word("ah", "S. paratyphi AH"), word("bh", "S. paratyphi BH")],
  "dengue-ns1": [word("ns1", "Dengue NS1 antigen", "Negative")],
  "malaria-ag": [word("pf", "P. falciparum antigen", "Negative"), word("pv", "P. vivax antigen", "Negative")],
  "blood-group": [word("abo", "ABO group"), word("rh", "Rh type")],
};
