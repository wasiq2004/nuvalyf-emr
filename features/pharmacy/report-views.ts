import "server-only";

// The pharmacy report views (docs/PHARMACY_DESIGN.md 5), each defined once as
// typed table sections. The page renders them and the CSV export writes the
// same sections, so what is on screen and what is exported never differ.
import type { Tx } from "@/lib/db";
import { fromMinor, toMinor } from "@/lib/money";
import { addDaysToDateString } from "@/lib/time";
import { closingStock, collectedByMethod, gstInput, gstOutput, gstr1, gstr3b, itemSales, ledgerMismatches, pharmacyRange, salesByDay, salesByUser, scheduleRegister, stockMovement } from "./pharmacy-reports.service";
import type { PharmacySettings } from "./settings.service";

export const REPORT_VIEWS = [
  { key: "sales", label: "Sales", period: "range" },
  { key: "items", label: "Items & margin", period: "range" },
  { key: "gst", label: "GST summary", period: "range" },
  { key: "gstr1", label: "GSTR-1", period: "month" },
  { key: "gstr3b", label: "GSTR-3B", period: "month" },
  { key: "register", label: "Schedule register", period: "range" },
  { key: "stock", label: "Closing stock", period: "asOn" },
  { key: "movement", label: "Stock movement", period: "range" },
] as const;
export type ReportView = (typeof REPORT_VIEWS)[number]["key"];

export type Cell = string | number | null;
export type Column = { key: string; label: string; kind?: "money" | "number" | "text" | "percent" };
export type Section = { key: string; title: string; description?: string; columns: Column[]; rows: Record<string, Cell>[]; totals?: Record<string, Cell> };

export type ReportParams = { view: ReportView; fromDate: string; toDate: string; month: string; withH: boolean };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_DAYS = 366;

/** Search params -> safe report parameters (this month, to today, by default). */
export function parseReportParams(sp: Record<string, string | undefined>, today: string): ReportParams {
  const view = (REPORT_VIEWS.find((v) => v.key === sp.view)?.key ?? "sales") as ReportView;
  let toDate = sp.to && DATE.test(sp.to) && sp.to <= today ? sp.to : today;
  let fromDate = sp.from && DATE.test(sp.from) && sp.from <= today ? sp.from : `${today.slice(0, 7)}-01`;
  if (fromDate > toDate) [fromDate, toDate] = [toDate, fromDate];
  if (addDaysToDateString(fromDate, MAX_DAYS) < toDate) fromDate = addDaysToDateString(toDate, -(MAX_DAYS - 1));
  const month = sp.month && MONTH.test(sp.month) && sp.month <= today.slice(0, 7) ? sp.month : today.slice(0, 7);
  return { view, fromDate, toDate, month, withH: sp.h === "1" };
}

/** Sum money / number columns over rows (paise-exact for money). */
function totals(rows: Record<string, Cell>[], columns: Column[], label: string): Record<string, Cell> {
  const out: Record<string, Cell> = { [columns[0]!.key]: label };
  for (const c of columns.slice(1)) {
    if (c.kind === "money") out[c.key] = fromMinor(rows.reduce((s, r) => s + toMinor(String(r[c.key] ?? "0")), 0));
    else if (c.kind === "number") out[c.key] = rows.reduce((s, r) => s + Number(r[c.key] ?? 0), 0);
  }
  return out;
}

function section(key: string, title: string, columns: Column[], rows: Record<string, Cell>[], opts: { description?: string; total?: string | false } = {}): Section {
  return { key, title, description: opts.description, columns, rows, totals: opts.total === false || rows.length === 0 ? undefined : totals(rows, columns, opts.total ?? "Total") };
}

const m = (key: string, label: string): Column => ({ key, label, kind: "money" });
const n = (key: string, label: string): Column => ({ key, label, kind: "number" });
const t = (key: string, label: string): Column => ({ key, label, kind: "text" });

export async function buildReport(tx: Tx, p: ReportParams, timeZone: string, settings: PharmacySettings): Promise<Section[]> {
  const r = pharmacyRange(p.fromDate, p.toDate, timeZone);
  switch (p.view) {
    case "sales": {
      const days = await salesByDay(tx, r);
      const collected = await collectedByMethod(tx, r);
      const staff = await salesByUser(tx, r);
      return [
        section(
          "by-day",
          "Sales by day",
          [t("day", "Day"), n("invoices", "Bills"), m("gross", "Items"), m("discount", "Discount"), m("tax", "GST"), m("round_off", "Round-off"), m("sales", "Billed"), m("returns", "Returned"), m("net", "Net")],
          days,
          { description: "Billed is what the bills came to; returned is credit notes issued that day; GST is net of credit notes." },
        ),
        section("collected", "Money collected", [t("method", "Method"), m("amount", "Amount")], [
          ...collected.methods.map((x) => ({ method: x.method.toUpperCase(), amount: x.amount })),
        ], { description: `Paid sales, less refunds paid out, plus payments received on account. Sold on credit in this period: ${collected.onCredit}.` }),
        section("staff", "Sales by staff", [t("name", "Staff"), n("invoices", "Bills"), m("total", "Billed")], staff),
      ];
    }
    case "items": {
      const items = await itemSales(tx, r);
      const columns = [t("name", "Item"), n("units", "Units"), m("value", "Sales"), m("taxable", "Taxable"), m("cost", "Cost"), m("margin", "Margin"), { key: "marginPercent", label: "Margin %", kind: "percent" } as Column];
      const s = section("items", "Item-wise sales and margin", columns, items.map((i) => ({ ...i })), {
        description: "Net of returns. Margin is taxable value less purchase cost, both before GST. Items without a recorded cost show full margin.",
      });
      if (s.totals) {
        const taxable = toMinor(String(s.totals.taxable));
        s.totals.marginPercent = taxable > 0 ? Math.round(((taxable - toMinor(String(s.totals.cost))) * 1000) / taxable) / 10 : null;
      }
      return [s];
    }
    case "gst": {
      const byRate = await gstOutput(tx, r, "rate");
      const byHsn = await gstOutput(tx, r, "hsn");
      const input = await gstInput(tx, r);
      return [
        section("output-rate", "Output tax by rate", [t("rate", "GST %"), m("value", "Sales incl. GST"), m("taxable", "Taxable"), m("cgst", "CGST"), m("sgst", "SGST"), m("igst", "IGST")], byRate, {
          description: "Sales less credit notes.",
        }),
        section("output-hsn", "Output tax by HSN", [t("hsn", "HSN"), t("rate", "GST %"), n("units", "Units"), m("taxable", "Taxable"), m("cgst", "CGST"), m("sgst", "SGST"), m("igst", "IGST")], byHsn),
        section("input", "Input tax by rate", [t("rate", "GST %"), m("taxable", "Taxable"), m("cgst", "CGST"), m("sgst", "SGST"), m("tax", "Total GST")], input, {
          description: "Supplier bills by bill date, less debit notes.",
        }),
      ];
    }
    case "gstr1": {
      const g = await gstr1(tx, p.month, timeZone, settings.stateCode);
      return [
        section(
          "b2b",
          "4A · B2B invoices",
          [t("gstin", "Buyer GSTIN"), t("customer", "Buyer"), t("number", "Invoice"), t("date", "Date"), m("invoice_value", "Invoice value"), t("place", "Place of supply"), t("rate", "Rate"), m("taxable", "Taxable"), m("igst", "IGST"), m("cgst", "CGST"), m("sgst", "SGST")],
          g.b2b,
          { total: false },
        ),
        section("b2cs", "7 · B2C (small) summary", [t("place", "Place of supply"), t("rate", "Rate"), m("taxable", "Taxable"), m("igst", "IGST"), m("cgst", "CGST"), m("sgst", "SGST")], g.b2cs, {
          description: "Sales to unregistered buyers, net of their credit notes.",
        }),
        section(
          "cdnr",
          "9B · Credit notes (registered)",
          [t("gstin", "Buyer GSTIN"), t("note", "Note"), t("date", "Date"), t("invoice", "Invoice"), m("note_value", "Note value"), t("rate", "Rate"), m("taxable", "Taxable"), m("igst", "IGST"), m("cgst", "CGST"), m("sgst", "SGST")],
          g.cdnr,
          { total: false },
        ),
        section("hsn", "12 · HSN summary", [t("hsn", "HSN"), t("rate", "Rate"), n("units", "Quantity"), m("value", "Total value"), m("taxable", "Taxable"), m("igst", "IGST"), m("cgst", "CGST"), m("sgst", "SGST")], g.hsn),
        section("docs", "13 · Documents issued", [t("kind", "Document"), t("first", "From"), t("last", "To"), n("total", "Total"), n("cancelled", "Cancelled")], g.docs, { total: false }),
      ];
    }
    case "gstr3b": {
      const g = await gstr3b(tx, p.month, timeZone);
      const payable = (k: "cgst" | "sgst" | "igst") => fromMinor(toMinor(g.outward[k]) - toMinor(g.itc[k]));
      return [
        section(
          "3b",
          "GSTR-3B",
          [t("head", ""), m("taxable", "Taxable"), m("igst", "IGST"), m("cgst", "CGST"), m("sgst", "SGST")],
          [
            { head: "3.1(a) Outward taxable supplies", ...g.outward },
            { head: "3.1(c) Nil rated / exempt", taxable: g.nilRated.taxable, igst: null, cgst: null, sgst: null },
            { head: "4(A)(5) Input tax credit, all other ITC", ...g.itc },
            { head: "Tax less ITC (before set-off rules)", taxable: null, igst: payable("igst"), cgst: payable("cgst"), sgst: payable("sgst") },
          ],
          { total: false, description: "Worked from this pharmacy's own documents. Check against the GST portal (GSTR-2B) before filing." },
        ),
      ];
    }
    case "stock": {
      const lines = await closingStock(tx, r);
      const group = (label: string, list: typeof lines) => ({
        state: label,
        batches: list.length,
        units: list.reduce((s, l) => s + l.units, 0),
        cost: fromMinor(list.reduce((s, l) => s + (l.cost ?? 0), 0)),
        at_mrp: fromMinor(list.reduce((s, l) => s + (l.atMrp ?? 0), 0)),
        no_cost: list.filter((l) => l.cost === null).length,
        no_mrp: list.filter((l) => l.atMrp === null).length,
      });
      return [
        section(
          "stock-totals",
          `Stock at the end of ${p.toDate}`,
          [t("state", ""), n("batches", "Batches"), n("units", "Units"), m("cost", "At cost"), m("at_mrp", "At MRP"), n("no_cost", "No cost"), n("no_mrp", "No MRP")],
          [group("Sellable", lines.filter((l) => !l.expired)), group("Expired", lines.filter((l) => l.expired))],
          { description: "Set these totals beside the old software's closing stock. Batches with no cost or no MRP are left out of that value, and counted in the last two columns." },
        ),
        section(
          "stock-batches",
          "Batch by batch",
          [t("name", "Item"), t("rack", "Rack"), t("batch", "Batch"), t("expiry", "Expiry"), t("state", "State"), n("pack", "Pack"), t("packs", "Packs + loose"), n("units", "Units"), m("mrp", "MRP"), m("costValue", "At cost"), m("mrpValue", "At MRP")],
          lines.map((l) => ({ name: l.name, rack: l.rack, batch: l.batch, expiry: l.expiry, state: l.state, pack: l.pack, packs: l.packs, units: l.units, mrp: l.mrp, costValue: l.costValue, mrpValue: l.mrpValue })),
          { description: "From the ledger, so a past date shows what was on hand that day." },
        ),
      ];
    }
    case "movement": {
      const moved = await stockMovement(tx, r);
      const mismatches = await ledgerMismatches(tx);
      return [
        section(
          "movement",
          "Stock movement",
          [t("head", ""), n("units_in", "In"), n("units_out", "Out")],
          [{ head: `At the start of ${p.fromDate}`, units_in: moved.opening, units_out: null }, ...moved.lines, { head: `At the end of ${p.toDate}`, units_in: moved.closing, units_out: null }],
          {
            total: false,
            description: mismatches === 0 ? "In single units. The start, plus everything in, less everything out, comes to the end. Every batch agrees with its ledger." : `${mismatches} batch(es) disagree with their ledger. This should never happen: contact support.`,
          },
        ),
      ];
    }
    case "register": {
      const list = await scheduleRegister(tx, r, p.withH);
      return [
        section(
          "register",
          p.withH ? "Schedule H, H1 and X register" : "Schedule H1 and X register",
          [t("date", "Date"), t("number", "Bill"), t("patient", "Patient"), t("address", "Address"), t("prescriber", "Prescriber"), t("reg_no", "Reg. no."), t("drug", "Medicine"), t("schedule", "Sch."), t("batch", "Batch"), n("quantity", "Qty"), n("returned", "Returned")],
          list,
          { total: false, description: "Drugs Rules 65(9): kept for three years and open to inspection." },
        ),
      ];
    }
  }
}
