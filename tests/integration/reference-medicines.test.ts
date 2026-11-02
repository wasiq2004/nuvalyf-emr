// The shared Indian medicine list: every clinic reads it, nobody but the
// owner writes it, and a clinic copies an entry into its own list once.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ownerSql } from "./test-db";
import { createTestClinic } from "./fixtures";
import { withClinic } from "@/lib/db";
import { pgError } from "@/lib/errors";
import { addFromReference, referenceSize, searchReference } from "@/features/catalog/reference.service";
import { searchItems } from "@/features/catalog/items.service";
import { searchDrugs } from "@/features/clinical/prescriptions.service";

const owner = ownerSql();
let clinicA: Awaited<ReturnType<typeof createTestClinic>>;
let clinicB: Awaited<ReturnType<typeof createTestClinic>>;
let adminA: string;
let adminB: string;
const ids: Record<string, number> = {};

const asA = <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic({ clinicId: clinicA.clinicId, userId: adminA }, fn);
const asB = <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic({ clinicId: clinicB.clinicId, userId: adminB }, fn);

beforeAll(async () => {
  clinicA = await createTestClinic("refa");
  clinicB = await createTestClinic("refb");
  adminA = (await owner`select id from app.users where clinic_id = ${clinicA.clinicId}`)[0].id;
  adminB = (await owner`select id from app.users where clinic_id = ${clinicB.clinicId}`)[0].id;
  // A few list entries (the full list is loaded on deploy, not in tests).
  const rows = [
    { source_id: 900001, name: "Dolo 650 Tablet", normalized: "dolo 650 tablet", manufacturer: "Micro Labs Ltd", composition: "Paracetamol (650mg)", generic_name: "Paracetamol", strength: "650mg", form: "tablet", pack_label: "strip of 15 tablets", pack_size: 15, mrp: "30.91", discontinued: false },
    { source_id: 900002, name: "Dolo 650 Old Tablet", normalized: "dolo 650 old tablet", manufacturer: "Micro Labs Ltd", composition: "Paracetamol (650mg)", generic_name: "Paracetamol", strength: "650mg", form: "tablet", pack_label: "strip of 10 tablets", pack_size: 10, mrp: "20.00", discontinued: true },
    { source_id: 900003, name: "Ascoril LS Syrup", normalized: "ascoril ls syrup", manufacturer: "Glenmark", composition: "Ambroxol (30mg/5ml) + Levosalbutamol (1mg/5ml)", generic_name: "Ambroxol + Levosalbutamol", strength: "30mg/5ml + 1mg/5ml", form: "syrup", pack_label: "bottle of 100 ml Syrup", pack_size: 1, mrp: "118.00", discontinued: false },
    { source_id: 900004, name: "Paracetamol 650", normalized: "paracetamol 650", manufacturer: "Generic", composition: "Paracetamol (650mg)", generic_name: "Paracetamol", strength: "650mg", form: "tablet", pack_label: "strip of 10 tablets", pack_size: 10, mrp: "12.00", discontinued: false },
  ];
  const inserted = await owner`insert into ref.medicines ${owner(rows)} on conflict (source_id) do update set name = excluded.name returning id, source_id`;
  for (const r of inserted) ids[r.source_id] = r.id;
  await owner`insert into ref.datasets (name, version, rows) values ('indian-medicines', 'test', 4) on conflict (name) do nothing`;
});

afterAll(async () => {
  await owner.end();
});

describe("the shared medicine list", () => {
  it("is searchable by any clinic, current products first", async () => {
    const hits = await asA((tx) => searchReference(tx, "dolo 650"));
    expect(hits.map((h) => h.name)).toEqual(["Dolo 650 Tablet", "Dolo 650 Old Tablet"]);
    expect(hits[0]).toMatchObject({ packSize: 15, mrp: "30.91", discontinued: false, clinicDrugId: null });
    expect((await asA((tx) => searchReference(tx, "ls ascoril"))).map((h) => h.name)).toEqual(["Ascoril LS Syrup"]);
    expect(await asA((tx) => referenceSize(tx))).toBeGreaterThan(0);
  });

  it("cannot be changed from the app", async () => {
    const code = (run: Promise<unknown>) => run.then(() => "allowed", (error) => pgError(error)?.code);
    // 42501: insufficient privilege.
    expect(await code(asA((tx) => tx.execute(sql`update ref.medicines set mrp = 1`)))).toBe("42501");
    expect(await code(asA((tx) => tx.execute(sql`insert into ref.datasets (name, version, rows) values ('x', 'x', 0)`)))).toBe("42501");
  });
});

describe("adding to a clinic's list", () => {
  it("copies the entry once, without a price, ready to prescribe and stock", async () => {
    const first = await asA((tx) => addFromReference(tx, clinicA.clinicId, ids[900001]));
    expect(first.created).toBe(true);
    expect(first.item).toMatchObject({ name: "Dolo 650 Tablet", genericName: "Paracetamol", strength: "650mg", form: "tablet", packSize: 15, manufacturer: "Micro Labs Ltd", price: null });
    const again = await asA((tx) => addFromReference(tx, clinicA.clinicId, ids[900001]));
    expect(again).toMatchObject({ created: false, item: { id: first.item.id } });

    expect((await asA((tx) => searchReference(tx, "dolo 650")))[0].clinicDrugId).toBe(first.item.id);
    expect((await asA((tx) => searchItems(tx, "dolo")))[0].id).toBe(first.item.id);
    expect((await asA((tx) => searchDrugs(tx, "dolo"))).map((d) => d.id)).toContain(first.item.id);
  });

  it("links an item the clinic already has by that name instead of duplicating it", async () => {
    const [existing] = await owner`select id from app.drugs where clinic_id = ${clinicA.clinicId} and name = 'Paracetamol 650'`;
    const result = await asA((tx) => addFromReference(tx, clinicA.clinicId, ids[900004]));
    expect(result).toMatchObject({ created: false, item: { id: existing.id } });
    const [linked] = await owner`select reference_id from app.drugs where id = ${existing.id}`;
    expect(linked.reference_id).toBe(ids[900004]);
  });

  it("keeps each clinic's copy its own", async () => {
    const b = await asB((tx) => addFromReference(tx, clinicB.clinicId, ids[900001]));
    expect(b.created).toBe(true);
    const copies = await owner`select clinic_id from app.drugs where reference_id = ${ids[900001]}`;
    expect(copies.map((c) => c.clinic_id).sort()).toEqual([clinicA.clinicId, clinicB.clinicId].sort());
    // Clinic A sees only its own copy as "in your list".
    const [hit] = await asA((tx) => searchReference(tx, "dolo 650 tablet"));
    const [mine] = await owner`select id from app.drugs where clinic_id = ${clinicA.clinicId} and reference_id = ${ids[900001]}`;
    expect(hit.clinicDrugId).toBe(mine.id);
  });

  it("refuses an entry that does not exist", async () => {
    await expect(asA((tx) => addFromReference(tx, clinicA.clinicId, 999_999_999))).rejects.toThrow(/not in the list/);
  });
});
