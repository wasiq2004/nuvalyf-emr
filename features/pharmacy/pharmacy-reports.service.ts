import "server-only";

// Pharmacy and GST reports (docs/PHARMACY_DESIGN.md 5). Every figure is a
// dated sum over append-only documents (sales, credit notes, bills, debit
// notes), so a closed month always reports the same. Raw SQL: dates travel as
// ISO strings with explicit casts, and day grouping is by position.
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { fromMinor, toMinor } from "@/lib/money";
import { addDaysToDateString, zonedTimeToUtc } from "@/lib/time";
import { costValue, mrpValue } from "./stock-rules";

export type PharmacyRange = { fromDate: string; toDate: string; timeZone: string; from: string; to: string };

/** Inclusive local dates -> a UTC [from, to) range. */
export function pharmacyRange(fromDate: string, toDate: string, timeZone: string): PharmacyRange {
  return {
    fromDate,
    toDate,
    timeZone,
    from: zonedTimeToUtc(fromDate, "00:00", timeZone).toISOString(),
    to: zonedTimeToUtc(addDaysToDateString(toDate, 1), "00:00", timeZone).toISOString(),
  };
}

/** A calendar month (yyyy-mm) as a range. */
export function monthRange(month: string, timeZone: string): PharmacyRange {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return pharmacyRange(`${month}-01`, `${month}-${String(last).padStart(2, "0")}`, timeZone);
}

type Row = Record<string, unknown>;
async function rows<T extends Row>(tx: Tx, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await tx.execute(query)) as unknown as T[];
}


// Shared fragments --------------------------------------------------------
const salesIn = (r: PharmacyRange) => sql`s.sold_at >= ${r.from}::timestamptz and s.sold_at < ${r.to}::timestamptz`;
const returnsIn = (r: PharmacyRange) => sql`cn.created_at >= ${r.from}::timestamptz and cn.created_at < ${r.to}::timestamptz`;

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export async function salesByDay(tx: Tx, r: PharmacyRange) {
  const result = await rows<{ day: string; invoices: number; gross: string; discount: string; tax: string; round_off: string; sales: string; returns: string }>(
    tx,
    sql`
      select to_char(day, 'YYYY-MM-DD') as day, sum(invoices)::int as invoices, sum(gross)::numeric(14,2)::text as gross,
             sum(discount)::numeric(14,2)::text as discount, sum(tax)::numeric(14,2)::text as tax, sum(round_off)::numeric(14,2)::text as round_off,
             sum(sales)::numeric(14,2)::text as sales, sum(returns)::numeric(14,2)::text as returns
      from (
        select (s.sold_at at time zone ${r.timeZone})::date as day, 1 as invoices,
               (select coalesce(sum(i.amount), 0) from app.pharmacy_sale_items i where i.sale_id = s.id) as gross,
               s.discount, s.tax_total as tax, s.round_off, s.total as sales, 0::numeric as returns
        from app.pharmacy_sales s where ${salesIn(r)}
        union all
        select (cn.created_at at time zone ${r.timeZone})::date, 0, 0, 0, -cn.tax_total, 0, 0, cn.total
        from app.sale_returns cn where ${returnsIn(r)}
      ) d
      group by 1 order by 1`,
  );
  return result.map((x) => ({ ...x, net: fromMinor(toMinor(x.sales) - toMinor(x.returns)) }));
}

/** Money actually collected: paid sales - refunds paid out + receipts on account. */
export async function collectedByMethod(tx: Tx, r: PharmacyRange) {
  const result = await rows<{ method: string; amount: string }>(
    tx,
    sql`
      select method, sum(amount)::numeric(14,2)::text as amount from (
        select s.method, s.total as amount from app.pharmacy_sales s where ${salesIn(r)} and s.method not in ('credit', 'inpatient')
        union all
        select cn.refund_method, -cn.total from app.sale_returns cn where ${returnsIn(r)} and cn.refund_method not in ('account', 'inpatient')
        union all
        select c.method, c.amount from app.customer_receipts c where c.created_at >= ${r.from}::timestamptz and c.created_at < ${r.to}::timestamptz
      ) m group by method order by method`,
  );
  const credit = await rows<{ amount: string }>(tx, sql`select coalesce(sum(s.total), 0)::numeric(14,2)::text as amount from app.pharmacy_sales s where ${salesIn(r)} and s.method = 'credit'`);
  return { methods: result, onCredit: credit[0]?.amount ?? "0.00" };
}

export async function salesByUser(tx: Tx, r: PharmacyRange) {
  return rows<{ name: string; invoices: number; total: string }>(
    tx,
    sql`
      select trim(concat_ws(' ', u.title, u.first_name, u.last_name)) as name, count(*)::int as invoices, sum(s.total)::numeric(14,2)::text as total
      from app.pharmacy_sales s join app.users u on u.id = s.sold_by
      where ${salesIn(r)} group by 1 order by 3 desc`,
  );
}

/** Per item: units and value out, back, and margin over cost (ex-GST). */
export async function itemSales(tx: Tx, r: PharmacyRange) {
  const result = await rows<{ drug_id: string; name: string; units: number; units_back: number; net: string; net_back: string; taxable: string; taxable_back: string; cost: string; cost_back: string }>(
    tx,
    sql`
      select d.id as drug_id, d.name,
             coalesce(sum(x.units), 0)::int as units, coalesce(sum(x.units_back), 0)::int as units_back,
             coalesce(sum(x.net), 0)::numeric(14,2)::text as net, coalesce(sum(x.net_back), 0)::numeric(14,2)::text as net_back,
             coalesce(sum(x.taxable), 0)::numeric(14,2)::text as taxable, coalesce(sum(x.taxable_back), 0)::numeric(14,2)::text as taxable_back,
             coalesce(sum(x.cost), 0)::numeric(14,2)::text as cost, coalesce(sum(x.cost_back), 0)::numeric(14,2)::text as cost_back
      from (
        select i.drug_id, i.quantity as units, 0 as units_back, i.net, 0::numeric as net_back,
               coalesce(i.taxable, i.net) as taxable, 0::numeric as taxable_back,
               coalesce(i.unit_cost, 0) * i.quantity as cost, 0::numeric as cost_back
        from app.pharmacy_sale_items i join app.pharmacy_sales s on s.id = i.sale_id where ${salesIn(r)}
        union all
        select ri.drug_id, 0, ri.quantity, 0, ri.net, 0, ri.taxable, 0, coalesce(i.unit_cost, ri.unit_cost, 0) * ri.quantity
        from app.sale_return_items ri join app.sale_returns cn on cn.id = ri.return_id left join app.pharmacy_sale_items i on i.id = ri.sale_item_id
        where ${returnsIn(r)}
      ) x join app.drugs d on d.id = x.drug_id
      group by d.id, d.name order by sum(x.net) - sum(x.net_back) desc nulls last`,
  );
  return result.map((x) => {
    const taxable = toMinor(x.taxable) - toMinor(x.taxable_back);
    const cost = toMinor(x.cost) - toMinor(x.cost_back);
    return {
      drugId: x.drug_id,
      name: x.name,
      units: x.units - x.units_back,
      value: fromMinor(toMinor(x.net) - toMinor(x.net_back)),
      taxable: fromMinor(taxable),
      cost: fromMinor(cost),
      margin: fromMinor(taxable - cost),
      marginPercent: taxable > 0 ? Math.round(((taxable - cost) * 1000) / taxable) / 10 : null,
    };
  });
}

// ---------------------------------------------------------------------------
// GST
// ---------------------------------------------------------------------------

export type TaxRow = { rate: string; hsn?: string; units?: number; value: string; taxable: string; cgst: string; sgst: string; igst: string };

/** Output tax: sale lines - credit-note lines, by rate (and HSN). */
export async function gstOutput(tx: Tx, r: PharmacyRange, by: "rate" | "hsn") {
  const key = by === "hsn" ? sql`coalesce(x.hsn, '') as hsn, x.rate` : sql`x.rate`;
  const group = by === "hsn" ? sql`group by 1, 2 order by 1, 2` : sql`group by 1 order by 1`;
  const result = await rows<{ hsn?: string; rate: string; units: number; value: string; taxable: string; cgst: string; sgst: string; igst: string }>(
    tx,
    sql`
      select ${key}, sum(x.units)::int as units, sum(x.net)::numeric(14,2)::text as value, sum(x.taxable)::numeric(14,2)::text as taxable,
             sum(x.cgst)::numeric(14,2)::text as cgst, sum(x.sgst)::numeric(14,2)::text as sgst, sum(x.igst)::numeric(14,2)::text as igst
      from (
        select i.hsn, i.gst_rate::text as rate, i.quantity as units, i.net, coalesce(i.taxable, i.net) as taxable, i.cgst, i.sgst, i.igst
        from app.pharmacy_sale_items i join app.pharmacy_sales s on s.id = i.sale_id where ${salesIn(r)}
        union all
        select coalesce(i.hsn, ri.hsn), coalesce(i.gst_rate, ri.gst_rate)::text, -ri.quantity, -ri.net, -ri.taxable, -ri.cgst, -ri.sgst, -ri.igst
        from app.sale_return_items ri join app.sale_returns cn on cn.id = ri.return_id left join app.pharmacy_sale_items i on i.id = ri.sale_item_id
        where ${returnsIn(r)}
      ) x ${group}`,
  );
  return result.map((x) => ({ ...x, rate: String(Number(x.rate)) })) as TaxRow[];
}

/** Input tax: purchase-bill lines - debit-note lines, by rate. */
export async function gstInput(tx: Tx, r: PharmacyRange) {
  const result = await rows<{ rate: string; taxable: string; tax: string }>(
    tx,
    sql`
      select rate, sum(taxable)::numeric(14,2)::text as taxable, sum(tax)::numeric(14,2)::text as tax from (
        select i.gst_rate::text as rate, i.amount as taxable, i.tax_amount as tax
        from app.purchase_bill_items i join app.purchase_bills b on b.id = i.bill_id
        where b.bill_date >= ${r.fromDate}::date and b.bill_date <= ${r.toDate}::date
        union all
        select ri.gst_rate::text, -ri.taxable, -ri.tax
        from app.purchase_return_items ri join app.purchase_returns dn on dn.id = ri.return_id
        where dn.created_at >= ${r.from}::timestamptz and dn.created_at < ${r.to}::timestamptz
      ) x group by 1 order by 1`,
  );
  // Suppliers are in the pharmacy's state: input tax is CGST + SGST.
  return result.map((x) => {
    const tax = toMinor(x.tax);
    const cgst = Math.floor(tax / 2);
    return { rate: String(Number(x.rate)), taxable: x.taxable, tax: x.tax, cgst: fromMinor(cgst), sgst: fromMinor(tax - cgst) };
  });
}

/** GSTR-1 for a month: B2B invoices, B2C small summary, credit notes, HSN summary, documents issued. */
export async function gstr1(tx: Tx, month: string, timeZone: string, sellerState: string | null) {
  const r = monthRange(month, timeZone);
  const b2b = await rows<{ gstin: string; customer: string; number: string; date: string; invoice_value: string; place: string; rate: string; taxable: string; igst: string; cgst: string; sgst: string }>(
    tx,
    sql`
      select s.customer_gstin as gstin, coalesce(c.name, s.customer_name, '') as customer, s.number,
             to_char((s.sold_at at time zone ${timeZone})::date, 'DD-MM-YYYY') as date, s.total::text as invoice_value,
             coalesce(c.state_code, substr(s.customer_gstin, 1, 2)) as place, i.gst_rate::text as rate,
             sum(i.taxable)::numeric(14,2)::text as taxable, sum(i.igst)::numeric(14,2)::text as igst,
             sum(i.cgst)::numeric(14,2)::text as cgst, sum(i.sgst)::numeric(14,2)::text as sgst
      from app.pharmacy_sales s
      join app.pharmacy_sale_items i on i.sale_id = s.id
      left join app.pharmacy_customers c on c.id = s.customer_id
      where ${salesIn(r)} and s.customer_gstin is not null and s.fiscal_year is not null and i.taxable is not null
      group by s.id, c.name, c.state_code, i.gst_rate order by s.number, i.gst_rate`,
  );
  const b2cs = await rows<{ rate: string; taxable: string; cgst: string; sgst: string; igst: string }>(
    tx,
    sql`
      select rate, sum(taxable)::numeric(14,2)::text as taxable, sum(cgst)::numeric(14,2)::text as cgst, sum(sgst)::numeric(14,2)::text as sgst, sum(igst)::numeric(14,2)::text as igst
      from (
        select i.gst_rate::text as rate, i.taxable, i.cgst, i.sgst, i.igst
        from app.pharmacy_sale_items i join app.pharmacy_sales s on s.id = i.sale_id
        where ${salesIn(r)} and s.customer_gstin is null and i.taxable is not null
        union all
        select coalesce(i.gst_rate, ri.gst_rate)::text, -ri.taxable, -ri.cgst, -ri.sgst, -ri.igst
        from app.sale_return_items ri join app.sale_returns cn on cn.id = ri.return_id
        left join app.pharmacy_sale_items i on i.id = ri.sale_item_id left join app.pharmacy_sales s on s.id = i.sale_id
        where ${returnsIn(r)} and coalesce(s.customer_gstin, cn.customer_gstin) is null and (i.id is null or i.taxable is not null)
      ) x group by 1 order by 1`,
  );
  const cdnr = await rows<{ gstin: string; note: string; date: string; invoice: string; note_value: string; rate: string; taxable: string; igst: string; cgst: string; sgst: string }>(
    tx,
    sql`
      select coalesce(s.customer_gstin, cn.customer_gstin) as gstin, cn.number as note, to_char((cn.created_at at time zone ${timeZone})::date, 'DD-MM-YYYY') as date, coalesce(s.number, cn.old_bill_no) as invoice,
             cn.total::text as note_value, coalesce(i.gst_rate, ri.gst_rate)::text as rate, sum(ri.taxable)::numeric(14,2)::text as taxable,
             sum(ri.igst)::numeric(14,2)::text as igst, sum(ri.cgst)::numeric(14,2)::text as cgst, sum(ri.sgst)::numeric(14,2)::text as sgst
      from app.sale_returns cn left join app.pharmacy_sales s on s.id = cn.sale_id
      join app.sale_return_items ri on ri.return_id = cn.id left join app.pharmacy_sale_items i on i.id = ri.sale_item_id
      where ${returnsIn(r)} and coalesce(s.customer_gstin, cn.customer_gstin) is not null and (i.id is null or i.taxable is not null)
      group by cn.id, s.customer_gstin, cn.customer_gstin, s.number, cn.old_bill_no, coalesce(i.gst_rate, ri.gst_rate) order by cn.number`,
  );
  const hsn = await gstOutput(tx, r, "hsn");
  const docs = await rows<{ kind: string; first: string | null; last: string | null; total: number; cancelled: number }>(
    tx,
    sql`
      select 'Invoices for outward supply' as kind, min(s.number) as first, max(s.number) as last, count(*)::int as total,
             count(*) filter (where exists (select 1 from app.sale_returns c where c.sale_id = s.id and c.kind = 'cancellation'))::int as cancelled
      from app.pharmacy_sales s where ${salesIn(r)} and s.fiscal_year is not null
      union all
      select 'Credit notes', min(cn.number), max(cn.number), count(*)::int, 0 from app.sale_returns cn where ${returnsIn(r)}`,
  );
  return {
    month,
    b2b: b2b.map((x) => ({ ...x, rate: String(Number(x.rate)) })),
    b2cs: b2cs.map((x) => ({ ...x, rate: String(Number(x.rate)), place: sellerState ?? "" })),
    cdnr: cdnr.map((x) => ({ ...x, rate: String(Number(x.rate)) })),
    hsn,
    docs: docs.filter((d) => d.total > 0),
  };
}

/** GSTR-3B for a month: outward supplies (3.1) and input tax credit (4). */
export async function gstr3b(tx: Tx, month: string, timeZone: string) {
  const r = monthRange(month, timeZone);
  const out = await gstOutput(tx, r, "rate");
  const sum = (list: TaxRow[], k: keyof TaxRow) => fromMinor(list.reduce((s, x) => s + toMinor(String(x[k] ?? "0")), 0));
  const taxed = out.filter((x) => Number(x.rate) > 0);
  const nil = out.filter((x) => Number(x.rate) === 0);
  const input = await gstInput(tx, r);
  return {
    month,
    outward: { taxable: sum(taxed, "taxable"), igst: sum(taxed, "igst"), cgst: sum(taxed, "cgst"), sgst: sum(taxed, "sgst") },
    nilRated: { taxable: sum(nil, "taxable") },
    itc: {
      taxable: fromMinor(input.reduce((s, x) => s + toMinor(x.taxable), 0)),
      cgst: fromMinor(input.reduce((s, x) => s + toMinor(x.cgst), 0)),
      sgst: fromMinor(input.reduce((s, x) => s + toMinor(x.sgst), 0)),
      igst: "0.00",
    },
  };
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

export type ClosingLine = {
  name: string;
  rack: string | null;
  batch: string;
  expiry: string;
  pack: number;
  packs: string;
  units: number;
  mrp: string | null;
  costValue: string | null;
  mrpValue: string | null;
  state: string;
};

/**
 * Stock at the end of a day, batch by batch, worked from the ledger, so a past
 * date reports what was on hand then. This is the report to set beside the old
 * software's closing stock on the day of the move.
 */
export async function closingStock(tx: Tx, r: PharmacyRange) {
  const result = await rows<{ name: string; rack: string | null; item_pack: number; batch_no: string; expiry: string; unit_cost: string | null; pack_cost: string | null; pack_size: number | null; mrp: string | null; units: number }>(
    tx,
    sql`
      select d.name, d.rack, d.pack_size as item_pack, b.batch_no, b.expiry_date::text as expiry, b.unit_cost::text as unit_cost, b.pack_cost::text as pack_cost,
             b.pack_size, b.mrp::text as mrp, sum(m.change)::int as units
      from app.stock_movements m join app.stock_batches b on b.id = m.batch_id join app.drugs d on d.id = m.drug_id
      where m.created_at < ${r.to}::timestamptz
      group by d.id, d.name, d.rack, d.pack_size, b.id, b.batch_no, b.expiry_date, b.unit_cost, b.pack_cost, b.pack_size, b.mrp
      having sum(m.change) <> 0
      order by d.name, b.expiry_date`,
  );
  return result.map((x): ClosingLine & { cost: number | null; atMrp: number | null; expired: boolean } => {
    const batch = { quantity: x.units, unitCost: x.unit_cost, packCost: x.pack_cost, packSize: x.pack_size, mrp: x.mrp };
    const cost = costValue(batch);
    const atMrp = mrpValue(batch, x.item_pack);
    const expired = x.expiry < r.toDate;
    return {
      name: x.name,
      rack: x.rack,
      batch: x.batch_no,
      expiry: x.expiry,
      pack: x.item_pack,
      packs: x.item_pack > 1 ? `${Math.floor(x.units / x.item_pack)} + ${x.units % x.item_pack}` : String(x.units),
      units: x.units,
      mrp: x.mrp,
      costValue: cost === null ? null : fromMinor(cost),
      mrpValue: atMrp === null ? null : fromMinor(atMrp),
      state: expired ? "Expired" : "Sellable",
      cost,
      atMrp,
      expired,
    };
  });
}

const MOVEMENT_LABELS: Record<string, string> = {
  opening: "Opening stock loaded",
  receipt: "Received from suppliers",
  sale: "Sold at the counter",
  dispense: "Dispensed",
  return: "Returned by customers",
  supplier_return: "Sent back to suppliers",
  adjustment: "Corrections (counts and reversed imports)",
  expired: "Written off: expired",
  damaged: "Written off: damaged",
};

/** Opening + everything in - everything out = closing, in units, for a period. */
export async function stockMovement(tx: Tx, r: PharmacyRange) {
  const [before] = await rows<{ units: number }>(tx, sql`select coalesce(sum(change), 0)::int as units from app.stock_movements where created_at < ${r.from}::timestamptz`);
  const moved = await rows<{ reason: string; units_in: number; units_out: number }>(
    tx,
    sql`
      select reason, coalesce(sum(change) filter (where change > 0), 0)::int as units_in, coalesce(-sum(change) filter (where change < 0), 0)::int as units_out
      from app.stock_movements where created_at >= ${r.from}::timestamptz and created_at < ${r.to}::timestamptz
      group by reason order by reason`,
  );
  const closing = before.units + moved.reduce((n, m) => n + m.units_in - m.units_out, 0);
  return { opening: before.units, closing, lines: moved.map((m) => ({ head: MOVEMENT_LABELS[m.reason] ?? m.reason, units_in: m.units_in, units_out: m.units_out })) };
}

/** Batches whose quantity disagrees with their ledger. There should never be one. */
export async function ledgerMismatches(tx: Tx) {
  const [row] = await rows<{ n: number }>(
    tx,
    sql`select count(*)::int as n from app.stock_batches b where b.quantity <> coalesce((select sum(m.change) from app.stock_movements m where m.batch_id = b.id), 0)`,
  );
  return row.n;
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

/** Schedule H1 (and X) register, Drugs Rules 65(9). Include H with `withH`. */
export async function scheduleRegister(tx: Tx, r: PharmacyRange, withH = false) {
  const schedules = withH ? ["H", "H1", "X"] : ["H1", "X"];
  return rows<{ date: string; number: string; patient: string | null; address: string | null; prescriber: string | null; reg_no: string | null; drug: string; schedule: string; batch: string; quantity: number; returned: number }>(
    tx,
    sql`
      select to_char(s.sold_at at time zone ${r.timeZone}, 'DD-MM-YYYY HH24:MI') as date, s.number, s.customer_name as patient, s.patient_address as address,
             s.prescriber_name as prescriber, s.prescriber_reg_no as reg_no, i.description as drug, i.schedule, i.batch_no as batch, i.quantity,
             coalesce((select sum(ri.quantity) from app.sale_return_items ri where ri.sale_item_id = i.id), 0)::int as returned
      from app.pharmacy_sale_items i join app.pharmacy_sales s on s.id = i.sale_id
      where ${salesIn(r)} and i.schedule in ${sql.raw(`('${schedules.join("','")}')`)}
      order by s.sold_at, s.number`,
  );
}

