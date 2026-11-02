// The shared Indian medicine list: turning source rows into catalogue fields,
// and the file that ships with the repository.
import { describe, expect, it } from "vitest";
import { formFromLabel, packSizeFromLabel, parseComposition, toReferenceMedicine } from "@/features/catalog/reference-rules";
import { readMedicineFile } from "../../scripts/db/reference";

describe("reading pack labels", () => {
  it("finds the form", () => {
    expect(formFromLabel("strip of 10 tablets")).toBe("tablet");
    expect(formFromLabel("strip of 15 Capsule SR")).toBe("capsule");
    expect(formFromLabel("bottle of 100 ml Syrup")).toBe("syrup");
    expect(formFromLabel("bottle of 60 ml Oral Suspension")).toBe("suspension");
    expect(formFromLabel("vial of 1 Injection")).toBe("injection");
    expect(formFromLabel("packet of 6 injections")).toBe("injection");
    expect(formFromLabel("bottle of 10 ml Eye Drop")).toBe("drops");
    expect(formFromLabel("tube of 15 gm Cream")).toBe("cream");
    expect(formFromLabel("packet of 2.5 ml Respules")).toBe("inhaler");
    expect(formFromLabel("packet of 1 Kit")).toBe("other");
  });

  it("counts units in a pack; measured packs sell whole", () => {
    expect(packSizeFromLabel("strip of 10 tablets")).toBe(10);
    expect(packSizeFromLabel("box of 5 injection")).toBe(5);
    expect(packSizeFromLabel("bottle of 100 ml Syrup")).toBe(1);
    expect(packSizeFromLabel("tube of 15 gm Cream")).toBe(1);
    expect(packSizeFromLabel("Kit")).toBe(1);
  });

  it("splits a composition into generic and strength", () => {
    expect(parseComposition("Amoxycillin  (500mg) ")).toEqual({ name: "Amoxycillin", strength: "500mg" });
    expect(parseComposition("Vitamin D3")).toEqual({ name: "Vitamin D3", strength: null });
    expect(parseComposition("  ")).toBeNull();
  });
});

describe("a source row", () => {
  it("becomes a clinic-ready medicine", () => {
    const med = toReferenceMedicine({
      id: "1",
      name: "Augmentin 625 Duo Tablet",
      price: "223.42",
      discontinued: "FALSE",
      manufacturer: "Glaxo SmithKline Pharmaceuticals Ltd",
      packLabel: "strip of 10 tablets",
      composition1: "Amoxycillin  (500mg) ",
      composition2: "  Clavulanic Acid (125mg)",
    });
    expect(med).toMatchObject({
      sourceId: 1,
      normalized: "augmentin 625 duo tablet",
      genericName: "Amoxycillin + Clavulanic Acid",
      strength: "500mg + 125mg",
      form: "tablet",
      packSize: 10,
      mrp: "223.42",
      discontinued: false,
    });
  });

  it("skips rows without an id or a name, and bad prices", () => {
    const base = { id: "9", name: "X", price: "", discontinued: "TRUE", manufacturer: "", packLabel: "", composition1: "", composition2: "" };
    expect(toReferenceMedicine({ ...base, id: "abc" })).toBeNull();
    expect(toReferenceMedicine({ ...base, name: " ! " })).toBeNull();
    expect(toReferenceMedicine(base)).toMatchObject({ mrp: null, discontinued: true, genericName: "X", manufacturer: null });
  });
});

describe("the bundled list", () => {
  it("holds every medicine of the source file, all parsed", () => {
    const { version, rows } = readMedicineFile();
    expect(version).toMatch(/^[0-9a-f]{16}$/);
    expect(rows.length).toBe(253_973);
    expect(new Set(rows.map((r) => r.sourceId)).size).toBe(rows.length);
    expect(rows.every((r) => r.name && r.genericName && r.packSize >= 1)).toBe(true);
    expect(rows.find((r) => r.sourceId === 2)).toMatchObject({ name: "Azithral 500 Tablet", packSize: 5, form: "tablet" });
  }, 60_000);
});
