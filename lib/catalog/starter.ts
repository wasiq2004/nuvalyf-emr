// Starter templates (decision D6): a basic list that every clinic receives as
// its own editable copy at onboarding. Keys are stable forever - they are how
// a clinic is offered newer starter entries without duplicating or reviving
// anything it has changed or deactivated. Add entries freely; never re-use or
// rename a key.
//
// This is a convenience starting point, not clinical reference data. Clinics
// are expected to review and adapt it.

export type StarterDrug = {
  key: string;
  name: string;
  generic: string;
  form: string;
  strength?: string;
  category: string;
  dose?: string;
  frequency?: string;
  days?: number;
  instructions?: string;
  /** Starter allergy-class keys. */
  classes?: string[];
};

export const STARTER_ALLERGY_CLASSES = [
  { key: "penicillins", name: "Penicillins", description: "Amoxicillin, ampicillin, cloxacillin and related" },
  { key: "cephalosporins", name: "Cephalosporins", description: "Cefixime, cefuroxime, ceftriaxone and related" },
  { key: "sulfonamides", name: "Sulfonamides", description: "Sulfa antibiotics such as co-trimoxazole" },
  { key: "nsaids", name: "NSAIDs", description: "Ibuprofen, diclofenac, aceclofenac, naproxen" },
  { key: "salicylates", name: "Aspirin / salicylates", description: "Aspirin and other salicylates" },
  { key: "macrolides", name: "Macrolides", description: "Azithromycin, clarithromycin, erythromycin" },
  { key: "fluoroquinolones", name: "Fluoroquinolones", description: "Ciprofloxacin, ofloxacin, levofloxacin" },
  { key: "tetracyclines", name: "Tetracyclines", description: "Doxycycline, minocycline" },
  { key: "opioids", name: "Opioids", description: "Tramadol, codeine and related" },
  { key: "nitroimidazoles", name: "Nitroimidazoles", description: "Metronidazole, tinidazole, ornidazole" },
] as const;

export const STARTER_DRUGS: StarterDrug[] = [
  // Pain / fever
  { key: "paracetamol-500-tab", name: "Paracetamol 500", generic: "Paracetamol", form: "tablet", strength: "500 mg", category: "Analgesic / antipyretic", dose: "1 tablet", frequency: "TDS", days: 3, instructions: "After food" },
  { key: "paracetamol-650-tab", name: "Paracetamol 650", generic: "Paracetamol", form: "tablet", strength: "650 mg", category: "Analgesic / antipyretic", dose: "1 tablet", frequency: "TDS", days: 3, instructions: "After food" },
  { key: "paracetamol-250-syr", name: "Paracetamol syrup", generic: "Paracetamol", form: "syrup", strength: "250 mg/5 ml", category: "Analgesic / antipyretic", dose: "5 ml", frequency: "TDS", days: 3 },
  { key: "ibuprofen-400-tab", name: "Ibuprofen 400", generic: "Ibuprofen", form: "tablet", strength: "400 mg", category: "NSAID", dose: "1 tablet", frequency: "TDS", days: 3, instructions: "After food", classes: ["nsaids"] },
  { key: "diclofenac-50-tab", name: "Diclofenac 50", generic: "Diclofenac", form: "tablet", strength: "50 mg", category: "NSAID", dose: "1 tablet", frequency: "BD", days: 3, instructions: "After food", classes: ["nsaids"] },
  { key: "aceclofenac-100-tab", name: "Aceclofenac 100", generic: "Aceclofenac", form: "tablet", strength: "100 mg", category: "NSAID", dose: "1 tablet", frequency: "BD", days: 5, instructions: "After food", classes: ["nsaids"] },
  { key: "diclofenac-gel", name: "Diclofenac gel", generic: "Diclofenac", form: "gel", strength: "1%", category: "NSAID (topical)", dose: "Apply thinly", frequency: "TDS", days: 7, classes: ["nsaids"] },
  { key: "tramadol-50-cap", name: "Tramadol 50", generic: "Tramadol", form: "capsule", strength: "50 mg", category: "Opioid analgesic", dose: "1 capsule", frequency: "BD", days: 3, instructions: "After food", classes: ["opioids"] },

  // Antibiotics / anti-infectives
  { key: "amoxicillin-500-cap", name: "Amoxicillin 500", generic: "Amoxicillin", form: "capsule", strength: "500 mg", category: "Antibiotic", dose: "1 capsule", frequency: "TDS", days: 5, classes: ["penicillins"] },
  { key: "amoxiclav-625-tab", name: "Amoxicillin + Clavulanate 625", generic: "Amoxicillin + Clavulanic acid", form: "tablet", strength: "500 mg + 125 mg", category: "Antibiotic", dose: "1 tablet", frequency: "BD", days: 5, instructions: "After food", classes: ["penicillins"] },
  { key: "amoxicillin-250-syr", name: "Amoxicillin suspension", generic: "Amoxicillin", form: "suspension", strength: "250 mg/5 ml", category: "Antibiotic", dose: "5 ml", frequency: "TDS", days: 5, classes: ["penicillins"] },
  { key: "azithromycin-500-tab", name: "Azithromycin 500", generic: "Azithromycin", form: "tablet", strength: "500 mg", category: "Antibiotic", dose: "1 tablet", frequency: "OD", days: 3, instructions: "Before food", classes: ["macrolides"] },
  { key: "cefixime-200-tab", name: "Cefixime 200", generic: "Cefixime", form: "tablet", strength: "200 mg", category: "Antibiotic", dose: "1 tablet", frequency: "BD", days: 5, classes: ["cephalosporins"] },
  { key: "cefuroxime-500-tab", name: "Cefuroxime 500", generic: "Cefuroxime", form: "tablet", strength: "500 mg", category: "Antibiotic", dose: "1 tablet", frequency: "BD", days: 5, instructions: "After food", classes: ["cephalosporins"] },
  { key: "ciprofloxacin-500-tab", name: "Ciprofloxacin 500", generic: "Ciprofloxacin", form: "tablet", strength: "500 mg", category: "Antibiotic", dose: "1 tablet", frequency: "BD", days: 5, classes: ["fluoroquinolones"] },
  { key: "ofloxacin-200-tab", name: "Ofloxacin 200", generic: "Ofloxacin", form: "tablet", strength: "200 mg", category: "Antibiotic", dose: "1 tablet", frequency: "BD", days: 5, classes: ["fluoroquinolones"] },
  { key: "doxycycline-100-cap", name: "Doxycycline 100", generic: "Doxycycline", form: "capsule", strength: "100 mg", category: "Antibiotic", dose: "1 capsule", frequency: "BD", days: 7, instructions: "After food, with plenty of water", classes: ["tetracyclines"] },
  { key: "metronidazole-400-tab", name: "Metronidazole 400", generic: "Metronidazole", form: "tablet", strength: "400 mg", category: "Antibiotic / antiprotozoal", dose: "1 tablet", frequency: "TDS", days: 5, instructions: "After food. Avoid alcohol", classes: ["nitroimidazoles"] },
  { key: "cotrimoxazole-ds-tab", name: "Co-trimoxazole DS", generic: "Sulfamethoxazole + Trimethoprim", form: "tablet", strength: "800 mg + 160 mg", category: "Antibiotic", dose: "1 tablet", frequency: "BD", days: 5, classes: ["sulfonamides"] },
  { key: "fluconazole-150-tab", name: "Fluconazole 150", generic: "Fluconazole", form: "tablet", strength: "150 mg", category: "Antifungal", dose: "1 tablet", frequency: "Stat", days: 1 },
  { key: "clotrimazole-cream", name: "Clotrimazole cream", generic: "Clotrimazole", form: "cream", strength: "1%", category: "Antifungal (topical)", dose: "Apply thinly", frequency: "BD", days: 14 },
  { key: "albendazole-400-tab", name: "Albendazole 400", generic: "Albendazole", form: "tablet", strength: "400 mg", category: "Anthelmintic", dose: "1 tablet", frequency: "Stat", days: 1, instructions: "Chew, at bedtime" },

  // Allergy / respiratory
  { key: "cetirizine-10-tab", name: "Cetirizine 10", generic: "Cetirizine", form: "tablet", strength: "10 mg", category: "Antihistamine", dose: "1 tablet", frequency: "HS", days: 5, instructions: "At bedtime" },
  { key: "levocetirizine-5-tab", name: "Levocetirizine 5", generic: "Levocetirizine", form: "tablet", strength: "5 mg", category: "Antihistamine", dose: "1 tablet", frequency: "HS", days: 5, instructions: "At bedtime" },
  { key: "montelukast-10-tab", name: "Montelukast 10", generic: "Montelukast", form: "tablet", strength: "10 mg", category: "Anti-asthmatic", dose: "1 tablet", frequency: "HS", days: 14 },
  { key: "salbutamol-inhaler", name: "Salbutamol inhaler", generic: "Salbutamol", form: "inhaler", strength: "100 mcg/puff", category: "Bronchodilator", dose: "2 puffs", frequency: "SOS", instructions: "When breathless" },
  { key: "budesonide-inhaler", name: "Budesonide inhaler", generic: "Budesonide", form: "inhaler", strength: "200 mcg/puff", category: "Inhaled steroid", dose: "1 puff", frequency: "BD", days: 30, instructions: "Rinse mouth after use" },
  { key: "prednisolone-10-tab", name: "Prednisolone 10", generic: "Prednisolone", form: "tablet", strength: "10 mg", category: "Corticosteroid", dose: "1 tablet", frequency: "OD", days: 5, instructions: "After breakfast" },

  // Gastro
  { key: "pantoprazole-40-tab", name: "Pantoprazole 40", generic: "Pantoprazole", form: "tablet", strength: "40 mg", category: "Proton pump inhibitor", dose: "1 tablet", frequency: "OD", days: 14, instructions: "Before breakfast" },
  { key: "omeprazole-20-cap", name: "Omeprazole 20", generic: "Omeprazole", form: "capsule", strength: "20 mg", category: "Proton pump inhibitor", dose: "1 capsule", frequency: "OD", days: 14, instructions: "Before breakfast" },
  { key: "ondansetron-4-tab", name: "Ondansetron 4", generic: "Ondansetron", form: "tablet", strength: "4 mg", category: "Antiemetic", dose: "1 tablet", frequency: "SOS", days: 3, instructions: "When nauseous" },
  { key: "domperidone-10-tab", name: "Domperidone 10", generic: "Domperidone", form: "tablet", strength: "10 mg", category: "Antiemetic / prokinetic", dose: "1 tablet", frequency: "TDS", days: 3, instructions: "Before food" },
  { key: "ors-sachet", name: "ORS", generic: "Oral rehydration salts", form: "sachet", category: "Rehydration", dose: "1 sachet in 1 litre water", frequency: "SOS", days: 3, instructions: "Sip after each loose stool" },
  { key: "lactulose-syr", name: "Lactulose syrup", generic: "Lactulose", form: "syrup", strength: "10 g/15 ml", category: "Laxative", dose: "15 ml", frequency: "HS", days: 7 },

  // Cardio / metabolic
  { key: "amlodipine-5-tab", name: "Amlodipine 5", generic: "Amlodipine", form: "tablet", strength: "5 mg", category: "Antihypertensive", dose: "1 tablet", frequency: "OD", days: 30 },
  { key: "telmisartan-40-tab", name: "Telmisartan 40", generic: "Telmisartan", form: "tablet", strength: "40 mg", category: "Antihypertensive", dose: "1 tablet", frequency: "OD", days: 30 },
  { key: "losartan-50-tab", name: "Losartan 50", generic: "Losartan", form: "tablet", strength: "50 mg", category: "Antihypertensive", dose: "1 tablet", frequency: "OD", days: 30 },
  { key: "atenolol-50-tab", name: "Atenolol 50", generic: "Atenolol", form: "tablet", strength: "50 mg", category: "Beta blocker", dose: "1 tablet", frequency: "OD", days: 30 },
  { key: "metformin-500-tab", name: "Metformin 500", generic: "Metformin", form: "tablet", strength: "500 mg", category: "Antidiabetic", dose: "1 tablet", frequency: "BD", days: 30, instructions: "After food" },
  { key: "glimepiride-1-tab", name: "Glimepiride 1", generic: "Glimepiride", form: "tablet", strength: "1 mg", category: "Antidiabetic", dose: "1 tablet", frequency: "OD", days: 30, instructions: "Before breakfast" },
  { key: "atorvastatin-10-tab", name: "Atorvastatin 10", generic: "Atorvastatin", form: "tablet", strength: "10 mg", category: "Statin", dose: "1 tablet", frequency: "HS", days: 30 },
  { key: "aspirin-75-tab", name: "Aspirin 75", generic: "Aspirin", form: "tablet", strength: "75 mg", category: "Antiplatelet", dose: "1 tablet", frequency: "OD", days: 30, instructions: "After food", classes: ["salicylates"] },
  { key: "clopidogrel-75-tab", name: "Clopidogrel 75", generic: "Clopidogrel", form: "tablet", strength: "75 mg", category: "Antiplatelet", dose: "1 tablet", frequency: "OD", days: 30 },
  { key: "warfarin-5-tab", name: "Warfarin 5", generic: "Warfarin", form: "tablet", strength: "5 mg", category: "Anticoagulant", dose: "1 tablet", frequency: "OD", days: 30, instructions: "Same time each day" },
  { key: "levothyroxine-50-tab", name: "Levothyroxine 50", generic: "Levothyroxine", form: "tablet", strength: "50 mcg", category: "Thyroid", dose: "1 tablet", frequency: "OD", days: 30, instructions: "Empty stomach, 30 min before breakfast" },

  // Supplements
  { key: "calcium-d3-tab", name: "Calcium + Vitamin D3", generic: "Calcium carbonate + Cholecalciferol", form: "tablet", strength: "500 mg + 250 IU", category: "Supplement", dose: "1 tablet", frequency: "OD", days: 30, instructions: "After food" },
  { key: "vitd3-60k-cap", name: "Vitamin D3 60,000 IU", generic: "Cholecalciferol", form: "capsule", strength: "60000 IU", category: "Supplement", dose: "1 capsule", frequency: "Weekly", days: 56, instructions: "Once a week, after food" },
  { key: "ifa-tab", name: "Iron + Folic acid", generic: "Ferrous sulphate + Folic acid", form: "tablet", strength: "100 mg + 0.5 mg", category: "Supplement", dose: "1 tablet", frequency: "OD", days: 30, instructions: "After food" },
  { key: "bcomplex-cap", name: "Vitamin B complex", generic: "Vitamin B complex", form: "capsule", category: "Supplement", dose: "1 capsule", frequency: "OD", days: 30 },
];

/** Interaction rules by generic name, so every brand of a molecule is covered. */
export const STARTER_INTERACTIONS: { key: string; a: string; b: string; severity: "minor" | "moderate" | "major" | "contraindicated"; description: string }[] = [
  { key: "warfarin-aspirin", a: "Warfarin", b: "Aspirin", severity: "major", description: "Greatly increased bleeding risk." },
  { key: "warfarin-ibuprofen", a: "Warfarin", b: "Ibuprofen", severity: "major", description: "Increased bleeding risk; NSAIDs also irritate the stomach lining." },
  { key: "warfarin-diclofenac", a: "Warfarin", b: "Diclofenac", severity: "major", description: "Increased bleeding risk." },
  { key: "warfarin-aceclofenac", a: "Warfarin", b: "Aceclofenac", severity: "major", description: "Increased bleeding risk." },
  { key: "warfarin-metronidazole", a: "Warfarin", b: "Metronidazole", severity: "major", description: "Metronidazole raises warfarin levels (INR rises); bleeding risk." },
  { key: "warfarin-fluconazole", a: "Warfarin", b: "Fluconazole", severity: "major", description: "Fluconazole raises warfarin levels (INR rises)." },
  { key: "warfarin-ciprofloxacin", a: "Warfarin", b: "Ciprofloxacin", severity: "moderate", description: "May raise INR; monitor." },
  { key: "warfarin-cotrimoxazole", a: "Warfarin", b: "Sulfamethoxazole", severity: "major", description: "Co-trimoxazole raises INR markedly." },
  { key: "warfarin-clopidogrel", a: "Warfarin", b: "Clopidogrel", severity: "major", description: "Combined anticoagulant and antiplatelet: high bleeding risk." },
  { key: "aspirin-ibuprofen", a: "Aspirin", b: "Ibuprofen", severity: "moderate", description: "Ibuprofen can blunt aspirin's antiplatelet effect; more GI bleeding." },
  { key: "aspirin-clopidogrel", a: "Aspirin", b: "Clopidogrel", severity: "moderate", description: "Additive bleeding risk; use only when intended (dual antiplatelet)." },
  { key: "clopidogrel-omeprazole", a: "Clopidogrel", b: "Omeprazole", severity: "moderate", description: "Omeprazole reduces clopidogrel activation; prefer pantoprazole." },
  { key: "domperidone-azithromycin", a: "Domperidone", b: "Azithromycin", severity: "major", description: "Both prolong the QT interval; risk of arrhythmia." },
  { key: "domperidone-ondansetron", a: "Domperidone", b: "Ondansetron", severity: "moderate", description: "Additive QT prolongation." },
  { key: "domperidone-fluconazole", a: "Domperidone", b: "Fluconazole", severity: "contraindicated", description: "Fluconazole raises domperidone levels; QT prolongation." },
  { key: "ondansetron-tramadol", a: "Ondansetron", b: "Tramadol", severity: "moderate", description: "Serotonergic combination; tramadol may also be less effective." },
  { key: "telmisartan-ibuprofen", a: "Telmisartan", b: "Ibuprofen", severity: "moderate", description: "NSAIDs reduce the BP effect and can impair kidney function." },
  { key: "losartan-ibuprofen", a: "Losartan", b: "Ibuprofen", severity: "moderate", description: "NSAIDs reduce the BP effect and can impair kidney function." },
  { key: "telmisartan-diclofenac", a: "Telmisartan", b: "Diclofenac", severity: "moderate", description: "NSAIDs reduce the BP effect and can impair kidney function." },
  { key: "losartan-diclofenac", a: "Losartan", b: "Diclofenac", severity: "moderate", description: "NSAIDs reduce the BP effect and can impair kidney function." },
  { key: "prednisolone-ibuprofen", a: "Prednisolone", b: "Ibuprofen", severity: "moderate", description: "Higher risk of stomach ulcers and bleeding." },
  { key: "prednisolone-diclofenac", a: "Prednisolone", b: "Diclofenac", severity: "moderate", description: "Higher risk of stomach ulcers and bleeding." },
  { key: "atorvastatin-fluconazole", a: "Atorvastatin", b: "Fluconazole", severity: "moderate", description: "Raised statin levels; risk of muscle damage." },
  { key: "glimepiride-fluconazole", a: "Glimepiride", b: "Fluconazole", severity: "moderate", description: "Raised glimepiride levels; risk of hypoglycaemia." },
  { key: "glimepiride-ciprofloxacin", a: "Glimepiride", b: "Ciprofloxacin", severity: "moderate", description: "Blood sugar swings (hypo- or hyperglycaemia)." },
  { key: "levothyroxine-calcium", a: "Levothyroxine", b: "Calcium carbonate", severity: "moderate", description: "Calcium reduces absorption; take 4 hours apart." },
  { key: "levothyroxine-iron", a: "Levothyroxine", b: "Ferrous sulphate", severity: "moderate", description: "Iron reduces absorption; take 4 hours apart." },
  { key: "ciprofloxacin-calcium", a: "Ciprofloxacin", b: "Calcium carbonate", severity: "moderate", description: "Calcium reduces absorption; take 2 hours before or 6 hours after." },
  { key: "doxycycline-calcium", a: "Doxycycline", b: "Calcium carbonate", severity: "moderate", description: "Calcium reduces absorption; separate doses." },
  { key: "doxycycline-iron", a: "Doxycycline", b: "Ferrous sulphate", severity: "moderate", description: "Iron reduces absorption; separate doses." },
  { key: "metronidazole-tinidazole", a: "Metronidazole", b: "Tinidazole", severity: "minor", description: "Duplicate nitroimidazole therapy." },
  { key: "atenolol-salbutamol", a: "Atenolol", b: "Salbutamol", severity: "moderate", description: "Beta blockers can oppose bronchodilators; caution in asthma." },
];

export const STARTER_PRESETS: { key: string; kind: "frequency" | "duration" | "instruction"; label: string; value: string }[] = [
  { key: "freq-od", kind: "frequency", label: "Once daily (OD) 1-0-0", value: "OD" },
  { key: "freq-bd", kind: "frequency", label: "Twice daily (BD) 1-0-1", value: "BD" },
  { key: "freq-tds", kind: "frequency", label: "Three times (TDS) 1-1-1", value: "TDS" },
  { key: "freq-qid", kind: "frequency", label: "Four times (QID)", value: "QID" },
  { key: "freq-hs", kind: "frequency", label: "At bedtime (HS) 0-0-1", value: "HS" },
  { key: "freq-sos", kind: "frequency", label: "When needed (SOS)", value: "SOS" },
  { key: "freq-stat", kind: "frequency", label: "Single dose now (Stat)", value: "Stat" },
  { key: "freq-weekly", kind: "frequency", label: "Once a week", value: "Weekly" },
  { key: "dur-1", kind: "duration", label: "1 day", value: "1" },
  { key: "dur-3", kind: "duration", label: "3 days", value: "3" },
  { key: "dur-5", kind: "duration", label: "5 days", value: "5" },
  { key: "dur-7", kind: "duration", label: "1 week", value: "7" },
  { key: "dur-10", kind: "duration", label: "10 days", value: "10" },
  { key: "dur-14", kind: "duration", label: "2 weeks", value: "14" },
  { key: "dur-30", kind: "duration", label: "1 month", value: "30" },
  { key: "dur-90", kind: "duration", label: "3 months", value: "90" },
  { key: "ins-after-food", kind: "instruction", label: "After food", value: "After food" },
  { key: "ins-before-food", kind: "instruction", label: "Before food", value: "Before food" },
  { key: "ins-empty-stomach", kind: "instruction", label: "Empty stomach", value: "On an empty stomach" },
  { key: "ins-bedtime", kind: "instruction", label: "At bedtime", value: "At bedtime" },
  { key: "ins-no-alcohol", kind: "instruction", label: "Avoid alcohol", value: "Avoid alcohol" },
  { key: "ins-water", kind: "instruction", label: "Plenty of water", value: "With plenty of water" },
];

/** A starter subset of WHO ICD-10 codes common in outpatient practice. */
export const STARTER_DIAGNOSES: { code: string; label: string; favourite?: boolean }[] = [
  { code: "J06.9", label: "Acute upper respiratory infection, unspecified", favourite: true },
  { code: "J02.9", label: "Acute pharyngitis, unspecified", favourite: true },
  { code: "J03.9", label: "Acute tonsillitis, unspecified" },
  { code: "J01.9", label: "Acute sinusitis, unspecified" },
  { code: "J20.9", label: "Acute bronchitis, unspecified" },
  { code: "J18.9", label: "Pneumonia, unspecified organism" },
  { code: "J30.4", label: "Allergic rhinitis, unspecified" },
  { code: "J45.9", label: "Asthma, unspecified" },
  { code: "R05", label: "Cough" },
  { code: "R50.9", label: "Fever, unspecified", favourite: true },
  { code: "B34.9", label: "Viral infection, unspecified", favourite: true },
  { code: "A09", label: "Infectious gastroenteritis and colitis, unspecified", favourite: true },
  { code: "A01.0", label: "Typhoid fever" },
  { code: "A90", label: "Dengue fever (classical dengue)" },
  { code: "B54", label: "Unspecified malaria" },
  { code: "A15.0", label: "Tuberculosis of lung" },
  { code: "B01.9", label: "Varicella without complication" },
  { code: "K29.7", label: "Gastritis, unspecified", favourite: true },
  { code: "K21.9", label: "Gastro-oesophageal reflux disease without oesophagitis" },
  { code: "K30", label: "Functional dyspepsia" },
  { code: "K59.0", label: "Constipation" },
  { code: "R10.4", label: "Other and unspecified abdominal pain" },
  { code: "R11", label: "Nausea and vomiting" },
  { code: "I10", label: "Essential (primary) hypertension", favourite: true },
  { code: "I20.9", label: "Angina pectoris, unspecified" },
  { code: "E11.9", label: "Type 2 diabetes mellitus without complications", favourite: true },
  { code: "E78.5", label: "Hyperlipidaemia, unspecified" },
  { code: "E03.9", label: "Hypothyroidism, unspecified" },
  { code: "E66.9", label: "Obesity, unspecified" },
  { code: "D50.9", label: "Iron deficiency anaemia, unspecified" },
  { code: "E55.9", label: "Vitamin D deficiency, unspecified" },
  { code: "N39.0", label: "Urinary tract infection, site not specified", favourite: true },
  { code: "N94.6", label: "Dysmenorrhoea, unspecified" },
  { code: "R51", label: "Headache" },
  { code: "G43.9", label: "Migraine, unspecified" },
  { code: "R42", label: "Dizziness and giddiness" },
  { code: "G47.0", label: "Insomnia" },
  { code: "F41.1", label: "Generalized anxiety disorder" },
  { code: "F32.9", label: "Depressive episode, unspecified" },
  { code: "M54.5", label: "Low back pain" },
  { code: "M79.1", label: "Myalgia" },
  { code: "M17.9", label: "Gonarthrosis (knee osteoarthritis), unspecified" },
  { code: "M25.5", label: "Pain in joint" },
  { code: "S93.4", label: "Sprain and strain of ankle" },
  { code: "T14.1", label: "Open wound of unspecified body region" },
  { code: "L30.9", label: "Dermatitis, unspecified" },
  { code: "L50.9", label: "Urticaria, unspecified" },
  { code: "B35.4", label: "Tinea corporis" },
  { code: "L70.0", label: "Acne vulgaris" },
  { code: "H10.9", label: "Conjunctivitis, unspecified" },
  { code: "H66.9", label: "Otitis media, unspecified" },
  { code: "T78.4", label: "Allergy, unspecified" },
  { code: "Z00.0", label: "General medical examination" },
  { code: "Z23", label: "Need for immunization" },
  { code: "Z09", label: "Follow-up examination after treatment" },
];

export type VitalKey = "temperature_c" | "systolic" | "diastolic" | "pulse" | "resp_rate" | "spo2" | "weight_kg" | "height_cm";

type RangeTemplate = {
  vital: VitalKey;
  ageMin: number;
  ageMax: number;
  low?: number;
  high?: number;
  criticalLow?: number;
  criticalHigh?: number;
};

/** Age-banded reference ranges (years, inclusive). Clinics tune these. */
export const STARTER_VITAL_RANGES: RangeTemplate[] = [
  { vital: "temperature_c", ageMin: 0, ageMax: 150, low: 36.0, high: 37.5, criticalLow: 35.0, criticalHigh: 40.0 },
  { vital: "spo2", ageMin: 0, ageMax: 150, low: 95, criticalLow: 90 },

  { vital: "pulse", ageMin: 0, ageMax: 0, low: 100, high: 160, criticalLow: 80, criticalHigh: 200 },
  { vital: "pulse", ageMin: 1, ageMax: 5, low: 80, high: 140, criticalLow: 60, criticalHigh: 180 },
  { vital: "pulse", ageMin: 6, ageMax: 12, low: 70, high: 120, criticalLow: 50, criticalHigh: 150 },
  { vital: "pulse", ageMin: 13, ageMax: 150, low: 60, high: 100, criticalLow: 40, criticalHigh: 130 },

  { vital: "resp_rate", ageMin: 0, ageMax: 0, low: 30, high: 60, criticalLow: 20, criticalHigh: 70 },
  { vital: "resp_rate", ageMin: 1, ageMax: 5, low: 20, high: 40, criticalLow: 15, criticalHigh: 55 },
  { vital: "resp_rate", ageMin: 6, ageMax: 12, low: 16, high: 30, criticalLow: 10, criticalHigh: 40 },
  { vital: "resp_rate", ageMin: 13, ageMax: 150, low: 12, high: 20, criticalLow: 8, criticalHigh: 30 },

  { vital: "systolic", ageMin: 1, ageMax: 12, low: 85, high: 120, criticalLow: 70, criticalHigh: 140 },
  { vital: "systolic", ageMin: 13, ageMax: 150, low: 90, high: 139, criticalLow: 80, criticalHigh: 180 },
  { vital: "diastolic", ageMin: 1, ageMax: 12, low: 50, high: 80, criticalLow: 40, criticalHigh: 95 },
  { vital: "diastolic", ageMin: 13, ageMax: 150, low: 60, high: 89, criticalLow: 50, criticalHigh: 120 },
];

export function vitalRangeKey(r: { vital: string; ageMin: number; ageMax: number }) {
  return `${r.vital}-${r.ageMin}-${r.ageMax}`;
}

export const STARTER_LAB_TESTS: { key: string; name: string; sample?: string; unit?: string; range?: string }[] = [
  { key: "cbc", name: "Complete blood count (CBC)", sample: "Blood (EDTA)" },
  { key: "hb", name: "Haemoglobin", sample: "Blood (EDTA)", unit: "g/dL", range: "M 13–17, F 12–15" },
  { key: "esr", name: "ESR", sample: "Blood (EDTA)", unit: "mm/hr", range: "M 0–15, F 0–20" },
  { key: "crp", name: "C-reactive protein (CRP)", sample: "Serum", unit: "mg/L", range: "< 6" },
  { key: "fbs", name: "Fasting blood sugar", sample: "Blood (fluoride)", unit: "mg/dL", range: "70–99" },
  { key: "ppbs", name: "Post-prandial blood sugar", sample: "Blood (fluoride)", unit: "mg/dL", range: "< 140" },
  { key: "rbs", name: "Random blood sugar", sample: "Blood (fluoride)", unit: "mg/dL", range: "< 140" },
  { key: "hba1c", name: "HbA1c", sample: "Blood (EDTA)", unit: "%", range: "< 5.7" },
  { key: "lipid", name: "Lipid profile", sample: "Serum (fasting)" },
  { key: "lft", name: "Liver function test (LFT)", sample: "Serum" },
  { key: "kft", name: "Kidney function test (KFT)", sample: "Serum" },
  { key: "creatinine", name: "Serum creatinine", sample: "Serum", unit: "mg/dL", range: "0.6–1.2" },
  { key: "electrolytes", name: "Serum electrolytes", sample: "Serum" },
  { key: "uric-acid", name: "Serum uric acid", sample: "Serum", unit: "mg/dL", range: "M 3.4–7.0, F 2.4–6.0" },
  { key: "tsh", name: "TSH", sample: "Serum", unit: "µIU/mL", range: "0.4–4.0" },
  { key: "vitd", name: "Vitamin D (25-OH)", sample: "Serum", unit: "ng/mL", range: "30–100" },
  { key: "b12", name: "Vitamin B12", sample: "Serum", unit: "pg/mL", range: "200–900" },
  { key: "urine-routine", name: "Urine routine & microscopy", sample: "Urine" },
  { key: "urine-hcg", name: "Urine pregnancy test (hCG)", sample: "Urine" },
  { key: "widal", name: "Widal test", sample: "Serum" },
  { key: "dengue-ns1", name: "Dengue NS1 antigen", sample: "Serum" },
  { key: "malaria-ag", name: "Malaria antigen (rapid)", sample: "Blood (EDTA)" },
  { key: "blood-group", name: "Blood group & Rh", sample: "Blood (EDTA)" },
];
