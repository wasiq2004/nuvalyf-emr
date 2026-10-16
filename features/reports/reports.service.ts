import "server-only";

// Clinic reports: money in, money owed, visit volume. Aggregates only - no
// patient-level rows leave these queries.
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { fromMinor, toMinor } from "@/lib/money";

// Raw SQL here: dates are passed as ISO strings with an explicit cast.
export type ReportRange = { from: Date; to: Date; fromDate: string; toDate: string; timeZone: string };

type Row = Record<string, unknown>;

async function rows<T extends Row>(tx: Tx, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await tx.execute(query)) as unknown as T[];
}

/** Money received per local day: clinic billing (net of refunds) and pharmacy sales. */
export async function collectionsByDay(tx: Tx, range: ReportRange) {
  const result = await rows<{ day: string; billing: string; pharmacy: string }>(
    tx,
    sql`
      select to_char(day, 'YYYY-MM-DD') as day, sum(billing)::numeric(14,2)::text as billing, sum(pharmacy)::numeric(14,2)::text as pharmacy
      from (
        select (received_at at time zone ${range.timeZone})::date as day,
               case when kind = 'payment' then amount else -amount end as billing,
               0::numeric as pharmacy
        from app.payments where received_at >= ${range.from.toISOString()}::timestamptz and received_at < ${range.to.toISOString()}::timestamptz
        union all
        select (sold_at at time zone ${range.timeZone})::date, 0::numeric, total
        from app.pharmacy_sales where sold_at >= ${range.from.toISOString()}::timestamptz and sold_at < ${range.to.toISOString()}::timestamptz
      ) money
      group by day order by day`,
  );
  return result.map((r) => ({ day: r.day, billing: r.billing, pharmacy: r.pharmacy }));
}

export async function collectionsByMethod(tx: Tx, range: ReportRange) {
  const result = await rows<{ method: string; billing: string; pharmacy: string }>(
    tx,
    sql`
      select method, sum(billing)::numeric(14,2)::text as billing, sum(pharmacy)::numeric(14,2)::text as pharmacy
      from (
        select method, case when kind = 'payment' then amount else -amount end as billing, 0::numeric as pharmacy
        from app.payments where received_at >= ${range.from.toISOString()}::timestamptz and received_at < ${range.to.toISOString()}::timestamptz
        union all
        select method, 0::numeric, total from app.pharmacy_sales where sold_at >= ${range.from.toISOString()}::timestamptz and sold_at < ${range.to.toISOString()}::timestamptz
      ) money
      group by method order by method`,
  );
  return result.map((r) => ({ method: r.method, billing: r.billing, pharmacy: r.pharmacy, total: fromMinor(toMinor(r.billing) + toMinor(r.pharmacy)) }));
}

/** Unpaid balances on issued invoices, by how long ago they were issued. */
export async function outstandingAging(tx: Tx, now: Date) {
  const result = await rows<{ bucket: string; invoices: number; amount: string }>(
    tx,
    sql`
      select bucket, count(*)::int as invoices, sum(total - amount_paid)::numeric(14,2)::text as amount
      from (
        select total, amount_paid,
          case
            when ${now.toISOString()}::timestamptz - issued_at <= interval '30 days' then '0-30'
            when ${now.toISOString()}::timestamptz - issued_at <= interval '60 days' then '31-60'
            when ${now.toISOString()}::timestamptz - issued_at <= interval '90 days' then '61-90'
            else '90+'
          end as bucket
        from app.invoices where status = 'issued' and amount_paid < total
      ) owed
      group by bucket`,
  );
  return ["0-30", "31-60", "61-90", "90+"].map((bucket) => {
    const row = result.find((r) => r.bucket === bucket);
    return { bucket, invoices: row?.invoices ?? 0, amount: row?.amount ?? "0.00" };
  });
}

export async function visitsByDay(tx: Tx, range: ReportRange) {
  return rows<{ day: string; seen: number; left: number; total: number }>(
    tx,
    sql`
      select to_char(visit_date, 'YYYY-MM-DD') as day,
             count(*) filter (where status = 'completed')::int as seen,
             count(*) filter (where status in ('left', 'cancelled'))::int as left,
             count(*)::int as total
      from app.visits where visit_date between ${range.fromDate} and ${range.toDate}
      group by visit_date order by visit_date`,
  );
}

export async function visitsByDoctor(tx: Tx, range: ReportRange) {
  return rows<{ doctor: string; seen: number; emergencies: number; avg_wait: number | null }>(
    tx,
    sql`
      select coalesce(nullif(trim(concat_ws(' ', u.title, u.first_name, u.last_name)), ''), 'Unassigned') as doctor,
             count(*) filter (where v.status = 'completed')::int as seen,
             count(*) filter (where v.is_emergency)::int as emergencies,
             round(avg(extract(epoch from (v.called_at - v.arrived_at)) / 60) filter (where v.called_at is not null))::int as avg_wait
      from app.visits v left join app.users u on u.id = v.doctor_id
      where v.visit_date between ${range.fromDate} and ${range.toDate}
      group by 1 order by seen desc`,
  );
}

export async function newPatients(tx: Tx, range: ReportRange) {
  const [row] = await rows<{ n: number }>(tx, sql`select count(*)::int as n from app.patients where created_at >= ${range.from.toISOString()}::timestamptz and created_at < ${range.to.toISOString()}::timestamptz`);
  return row?.n ?? 0;
}
