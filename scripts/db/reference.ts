// Loads shared reference lists into the ref schema (owner role only).
//
// The Indian medicine list ships with the repository as
// db/reference/indian-medicines.csv.gz (about 2.5 lakh rows). It is loaded
// on deploy (db:migrate / docker setup) only when the file has changed since
// the last load: a fingerprint of the file is kept in ref.datasets.
//
// Source: the public "A-Z Medicine Dataset of India", compiled from online
// pharmacy listings. Prices are the MRPs listed when it was compiled; they are
// a hint for staff, never used as a selling price on their own.
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { gunzipSync } from "zlib";
import { parseCsv } from "../../features/import/import-rules";
import { toReferenceMedicine, type ReferenceMedicine } from "../../features/catalog/reference-rules";
import type { Sql } from "./tasks";

const MEDICINES = { name: "indian-medicines", file: path.join("db", "reference", "indian-medicines.csv.gz") };
const CHUNK = 2000;

export function readMedicineFile(file = MEDICINES.file): { version: string; rows: ReferenceMedicine[] } {
  const zipped = fs.readFileSync(path.join(process.cwd(), file));
  const version = createHash("sha256").update(zipped).digest("hex").slice(0, 16);
  const [header, ...lines] = parseCsv(gunzipSync(zipped).toString("utf8"));
  const col = (name: string) => header.indexOf(name);
  const at = { id: col("id"), name: col("name"), price: col("price"), discontinued: col("discontinued"), manufacturer: col("manufacturer"), pack: col("pack_label"), c1: col("composition1"), c2: col("composition2") };
  if (Object.values(at).some((i) => i < 0)) throw new Error(`${file}: unexpected columns ${header.join(", ")}`);
  const rows = lines
    .map((r) =>
      toReferenceMedicine({
        id: r[at.id] ?? "",
        name: r[at.name] ?? "",
        price: r[at.price] ?? "",
        discontinued: r[at.discontinued] ?? "",
        manufacturer: r[at.manufacturer] ?? "",
        packLabel: r[at.pack] ?? "",
        composition1: r[at.c1] ?? "",
        composition2: r[at.c2] ?? "",
      }),
    )
    .filter((r): r is ReferenceMedicine => r !== null);
  return { version, rows };
}

/** Loads the medicine list if it is missing or out of date. Safe to run on every deploy. */
export async function loadReferenceMedicines(sql: Sql, options: { force?: boolean } = {}) {
  if (process.env.SKIP_REFERENCE_DATA === "true") {
    console.log("• Indian medicine list skipped (SKIP_REFERENCE_DATA)");
    return;
  }
  const { version, rows } = readMedicineFile();
  const [current] = await sql`select version, rows from ref.datasets where name = ${MEDICINES.name}`;
  if (current?.version === version && !options.force) {
    console.log(`✓ Indian medicine list up to date (${Number(current.rows).toLocaleString("en-IN")} medicines)`);
    return;
  }

  await sql.begin(async (transaction) => {
    // postgres.js types a transaction without its call signature; it is one.
    const tx = transaction as unknown as Sql;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map((r) => ({
        source_id: r.sourceId,
        name: r.name,
        normalized: r.normalized,
        manufacturer: r.manufacturer,
        composition: r.composition,
        generic_name: r.genericName,
        strength: r.strength,
        form: r.form,
        pack_label: r.packLabel,
        pack_size: r.packSize,
        mrp: r.mrp,
        discontinued: r.discontinued,
      }));
      await tx`
        insert into ref.medicines ${tx(chunk)}
        on conflict (source_id) do update set
          name = excluded.name, normalized = excluded.normalized, manufacturer = excluded.manufacturer,
          composition = excluded.composition, generic_name = excluded.generic_name, strength = excluded.strength,
          form = excluded.form, pack_label = excluded.pack_label, pack_size = excluded.pack_size,
          mrp = excluded.mrp, discontinued = excluded.discontinued`;
    }
    await tx`
      insert into ref.datasets (name, version, rows, loaded_at) values (${MEDICINES.name}, ${version}, ${rows.length}, now())
      on conflict (name) do update set version = excluded.version, rows = excluded.rows, loaded_at = now()`;
  });
  console.log(`✓ Indian medicine list loaded (${rows.length.toLocaleString("en-IN")} medicines)`);
}
