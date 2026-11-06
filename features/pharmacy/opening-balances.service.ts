import "server-only";

// What customers owed and suppliers were owed on the day the pharmacy moved to
// NuvaLyf. Balances stay sums of documents: an opening row is simply the first
// document. No tax and no stock move, so GST reports are untouched.
import { desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { accountOpenings, importJobs, pharmacyCustomers, suppliers } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { idempotent } from "@/lib/idempotency";
import { fromMinor, toMinor } from "@/lib/money";
import { parseCsv } from "./stock-import-rules";
import { normalizePartyName, validateBalanceRows, type BalanceProblem, type BalanceRow } from "./opening-balances-rules";

export type OpeningInput = { side: "customer" | "supplier"; partyId: string; amount: string; asOf: string; reference?: string; note?: string };

export async function addOpening(tx: Tx, clinicId: string, input: OpeningInput, actorId: string, today: string) {
  if (input.asOf > today) throw new AppError("The date is in the future.");
  if (toMinor(input.amount) === 0) throw new AppError("Enter the amount.");
  const table = input.side === "customer" ? pharmacyCustomers : suppliers;
  const [party] = await tx.select({ id: table.id, name: table.name }).from(table).where(eq(table.id, input.partyId)).limit(1);
  if (!party) throw new AppError("Account not found.");
  const [row] = await tx
    .insert(accountOpenings)
    .values({
      clinicId,
      customerId: input.side === "customer" ? party.id : null,
      supplierId: input.side === "supplier" ? party.id : null,
      amount: input.amount,
      asOf: input.asOf,
      reference: input.reference || null,
      note: input.note || null,
      createdBy: actorId,
    })
    .returning({ id: accountOpenings.id });
  return { id: row.id, name: party.name };
}

export type BalanceReport = {
  rows: number;
  customers: number;
  customerTotal: string;
  suppliers: number;
  supplierTotal: string;
  newParties: number;
  problems: BalanceProblem[];
};

async function parties(tx: Tx) {
  const customers = await tx.select({ id: pharmacyCustomers.id, name: pharmacyCustomers.name }).from(pharmacyCustomers);
  const sellers = await tx.select({ id: suppliers.id, name: suppliers.name }).from(suppliers);
  const opened = await tx.select({ customerId: accountOpenings.customerId, supplierId: accountOpenings.supplierId }).from(accountOpenings);
  return {
    customer: new Map(customers.map((c) => [normalizePartyName(c.name), c.id])),
    supplier: new Map(sellers.map((s) => [normalizePartyName(s.name), s.id])),
    opened: new Set(opened.flatMap((o) => [o.customerId, o.supplierId]).filter(Boolean)),
  };
}

async function plan(tx: Tx, csv: string, today: string): Promise<{ report: BalanceReport; rows: BalanceRow[]; known: Awaited<ReturnType<typeof parties>> }> {
  const parsed = parseCsv(csv);
  const { valid, problems } = validateBalanceRows(parsed, today);
  const known = await parties(tx);
  for (const row of valid) {
    const id = known[row.type].get(row.normalized);
    // Same rule as stock: a second upload must not add every balance again.
    if (id && known.opened.has(id)) problems.push({ line: row.line, field: "name", message: `${row.name} already has an opening balance. Correct it from their account` });
  }
  problems.sort((a, b) => a.line - b.line);
  const bad = new Set(problems.map((p) => p.line));
  const rows = valid.filter((r) => !bad.has(r.line));
  const sum = (type: BalanceRow["type"]) => rows.filter((r) => r.type === type).reduce((s, r) => s + toMinor(r.amount), 0);
  const names = (type: BalanceRow["type"]) => new Set(rows.filter((r) => r.type === type).map((r) => r.normalized));
  return {
    known,
    rows,
    report: {
      rows: Math.max(0, parsed.length - 1),
      customers: names("customer").size,
      customerTotal: fromMinor(sum("customer")),
      suppliers: names("supplier").size,
      supplierTotal: fromMinor(sum("supplier")),
      newParties: new Set(rows.filter((r) => !known[r.type].has(r.normalized)).map((r) => `${r.type}|${r.normalized}`)).size,
      problems,
    },
  };
}

export async function checkBalanceImport(tx: Tx, csv: string, today: string) {
  return (await plan(tx, csv, today)).report;
}

export async function runBalanceImport(tx: Tx, clinicId: string, input: { fileName: string; csv: string; idempotencyKey: string }, actorId: string, today: string) {
  return idempotent(tx, { clinicId, name: "balance-import", key: input.idempotencyKey, input: { fileName: input.fileName, csv: input.csv } }, async () => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`balance-import:${clinicId}`}, 0))`);
    const { report, rows, known } = await plan(tx, input.csv, today);
    if (report.problems.length > 0) throw new AppError(`Nothing was imported: ${report.problems.length} problem(s) in the file.`);
    if (rows.length === 0) throw new AppError("The file has no rows.");
    for (const row of rows) {
      let partyId = known[row.type].get(row.normalized);
      if (!partyId) {
        if (row.type === "customer") {
          const [created] = await tx.insert(pharmacyCustomers).values({ clinicId, name: row.name, phone: row.phone, gstin: row.gstin }).returning({ id: pharmacyCustomers.id });
          partyId = created.id;
        } else {
          const [created] = await tx.insert(suppliers).values({ clinicId, name: row.name, phone: row.phone, taxId: row.gstin }).returning({ id: suppliers.id });
          partyId = created.id;
        }
        known[row.type].set(row.normalized, partyId);
      }
      await tx.insert(accountOpenings).values({
        clinicId,
        customerId: row.type === "customer" ? partyId : null,
        supplierId: row.type === "supplier" ? partyId : null,
        amount: row.amount,
        asOf: row.asOf,
        reference: row.reference,
        note: `Imported from ${input.fileName}`.slice(0, 300),
        createdBy: actorId,
      });
    }
    const summary = { customers: report.customers, customerTotal: report.customerTotal, suppliers: report.suppliers, supplierTotal: report.supplierTotal };
    const [job] = await tx.insert(importJobs).values({ clinicId, kind: "balances", fileName: input.fileName, rowCount: report.rows, imported: rows.length, status: "imported", summary, createdBy: actorId }).returning({ id: importJobs.id });
    return { jobId: job.id, ...summary };
  });
}

export async function recordRejectedBalanceImport(tx: Tx, clinicId: string, fileName: string, report: BalanceReport, actorId: string) {
  await tx.insert(importJobs).values({ clinicId, kind: "balances", fileName, rowCount: report.rows, imported: 0, status: "rejected", errors: report.problems.slice(0, 200), createdBy: actorId });
}

export function listBalanceImports(tx: Tx) {
  return tx.select().from(importJobs).where(eq(importJobs.kind, "balances")).orderBy(desc(importJobs.createdAt)).limit(20);
}
