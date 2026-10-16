import "server-only";

// Reading the audit trail (compliance panel). Read-only: the table itself is
// append-only in the database. Patient identity is limited to record number
// and name; clinical details are withheld (audit-rules.ts).
import { and, asc, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { auditEvents, patients, roles, userRoles, users } from "@/lib/db/schema";
import { displayPatientName } from "@/features/patients/patient-rules";
import { staffName } from "@/features/clinical/encounters.service";
import { ACCESS_ACTIONS, categoryOf, redactDetails, type AuditFilters } from "./audit-rules";

export type AuditRange = { from: Date; to: Date };

export async function findPatientByMrn(tx: Tx, mrn: string) {
  const [row] = await tx.select().from(patients).where(eq(patients.mrn, mrn)).limit(1);
  return row ? { id: row.id, mrn: row.mrn, name: displayPatientName(row) } : null;
}

export async function listStaffForFilter(tx: Tx) {
  const rows = await tx
    .select({ id: users.id, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .orderBy(asc(users.firstName), asc(users.lastName));
  return rows.map((r) => ({ id: r.id, name: staffName(r) }));
}

export async function listActions(tx: Tx) {
  const rows = await tx.selectDistinct({ action: auditEvents.action }).from(auditEvents).orderBy(asc(auditEvents.action));
  return rows.map((r) => r.action);
}

export type AuditRow = {
  id: string;
  createdAt: Date;
  action: string;
  category: ReturnType<typeof categoryOf>;
  outcome: string;
  severity: string;
  actorId: string | null;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  patientMrn: string | null;
  patientName: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
};

export type AuditPage = { rows: AuditRow[]; nextCursor: string | null; patientNotFound: boolean };

/** One page of events, newest first. The cursor is "<iso time>|<id>". */
export async function searchAudit(tx: Tx, filters: AuditFilters, range: AuditRange, cursor: string | null, limit = 50): Promise<AuditPage> {
  let patientId: string | undefined;
  if (filters.patientMrn) {
    const patient = await findPatientByMrn(tx, filters.patientMrn);
    if (!patient) return { rows: [], nextCursor: null, patientNotFound: true };
    patientId = patient.id;
  }

  const conditions = [
    gte(auditEvents.createdAt, range.from),
    lt(auditEvents.createdAt, range.to),
    filters.actorId ? eq(auditEvents.actorUserId, filters.actorId) : undefined,
    patientId ? eq(auditEvents.patientId, patientId) : undefined,
    filters.action ? eq(auditEvents.action, filters.action) : undefined,
    filters.outcome ? eq(auditEvents.outcome, filters.outcome) : undefined,
    filters.severity ? eq(auditEvents.severity, filters.severity) : undefined,
  ];
  if (cursor) {
    const [time, id] = cursor.split("|");
    const at = new Date(time);
    if (!Number.isNaN(at.getTime()) && /^[0-9a-f-]{36}$/i.test(id ?? "")) {
      conditions.push(or(lt(auditEvents.createdAt, at), and(eq(auditEvents.createdAt, at), lt(auditEvents.id, id))));
    }
  }

  const rows = await tx
    .select({ event: auditEvents, actor: users, patient: patients })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .leftJoin(patients, eq(patients.id, auditEvents.patientId))
    .where(and(...conditions))
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page.map((r) => ({
      id: r.event.id,
      createdAt: r.event.createdAt,
      action: r.event.action,
      category: categoryOf(r.event.action),
      outcome: r.event.outcome,
      severity: r.event.severity,
      actorId: r.event.actorUserId,
      actorName: r.actor ? staffName(r.actor) : null,
      targetType: r.event.targetType,
      targetId: r.event.targetId,
      patientMrn: r.patient?.mrn ?? null,
      patientName: r.patient ? displayPatientName(r.patient) : null,
      details: redactDetails(r.event.action, r.event.details),
      ipAddress: r.event.ipAddress,
    })),
    nextCursor: rows.length > limit && last ? `${last.event.createdAt.toISOString()}|${last.event.id}` : null,
    patientNotFound: false,
  };
}

export type AccessSummary = {
  patient: { id: string; mrn: string; name: string };
  people: { actorId: string | null; name: string; roles: string; views: number; first: Date; last: Date; actions: string[] }[];
  events: AuditRow[];
};

/** "Who opened this record": every access event for one patient in a range. */
export async function recordAccess(tx: Tx, mrn: string, range: AuditRange): Promise<AccessSummary | null> {
  const patient = await findPatientByMrn(tx, mrn);
  if (!patient) return null;
  const rows = await tx
    .select({ event: auditEvents, actor: users })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(
      and(
        eq(auditEvents.patientId, patient.id),
        inArray(auditEvents.action, [...ACCESS_ACTIONS]),
        gte(auditEvents.createdAt, range.from),
        lt(auditEvents.createdAt, range.to),
      ),
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(1000);

  const actorIds = [...new Set(rows.map((r) => r.event.actorUserId).filter((v): v is string => Boolean(v)))];
  const roleRows = actorIds.length
    ? await tx.select({ userId: userRoles.userId, name: roles.name }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(inArray(userRoles.userId, actorIds))
    : [];

  const byActor = new Map<string, AccessSummary["people"][number]>();
  for (const r of rows) {
    const key = r.event.actorUserId ?? "unknown";
    const entry = byActor.get(key) ?? {
      actorId: r.event.actorUserId,
      name: r.actor ? staffName(r.actor) : "Unknown",
      roles: roleRows.filter((x) => x.userId === r.event.actorUserId).map((x) => x.name).join(", "),
      views: 0,
      first: r.event.createdAt,
      last: r.event.createdAt,
      actions: [],
    };
    entry.views += 1;
    if (r.event.createdAt < entry.first) entry.first = r.event.createdAt;
    if (r.event.createdAt > entry.last) entry.last = r.event.createdAt;
    if (!entry.actions.includes(r.event.action)) entry.actions.push(r.event.action);
    byActor.set(key, entry);
  }

  return {
    patient,
    people: [...byActor.values()].sort((a, b) => b.last.getTime() - a.last.getTime()),
    events: rows.map((r) => ({
      id: r.event.id,
      createdAt: r.event.createdAt,
      action: r.event.action,
      category: categoryOf(r.event.action),
      outcome: r.event.outcome,
      severity: r.event.severity,
      actorId: r.event.actorUserId,
      actorName: r.actor ? staffName(r.actor) : null,
      targetType: r.event.targetType,
      targetId: r.event.targetId,
      patientMrn: patient.mrn,
      patientName: patient.name,
      details: redactDetails(r.event.action, r.event.details),
      ipAddress: r.event.ipAddress,
    })),
  };
}

/** Aggregates for the compliance summary and the clinic reports page. */
export async function auditSummary(tx: Tx, range: AuditRange, timeZone: string) {
  const where = and(gte(auditEvents.createdAt, range.from), lt(auditEvents.createdAt, range.to));
  const day = sql<string>`to_char((${auditEvents.createdAt} at time zone ${timeZone})::date, 'YYYY-MM-DD')`;
  const [totals] = await tx
    .select({
      events: sql<number>`count(*)::int`,
      denied: sql<number>`count(*) filter (where ${auditEvents.outcome} = 'denied')::int`,
      critical: sql<number>`count(*) filter (where ${auditEvents.severity} = 'critical')::int`,
      warnings: sql<number>`count(*) filter (where ${auditEvents.severity} = 'warning')::int`,
      recordViews: sql<number>`count(*) filter (where ${inArray(auditEvents.action, [...ACCESS_ACTIONS])})::int`,
      failedSignIns: sql<number>`count(*) filter (where ${auditEvents.action} in ('LOGIN_FAILED', 'LOGIN_REFUSED'))::int`,
      people: sql<number>`count(distinct ${auditEvents.actorUserId})::int`,
    })
    .from(auditEvents)
    .where(where);
  const perDay = await tx
    .select({ day, events: sql<number>`count(*)::int`, denied: sql<number>`count(*) filter (where ${auditEvents.outcome} = 'denied')::int` })
    .from(auditEvents)
    .where(where)
    // By position: the time-zone parameter makes each copy of the expression distinct.
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  const topActions = await tx
    .select({ action: auditEvents.action, n: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(where)
    .groupBy(auditEvents.action)
    .orderBy(desc(sql`count(*)`))
    .limit(12);
  const topPeople = await tx
    .select({ actorId: auditEvents.actorUserId, title: users.title, firstName: users.firstName, lastName: users.lastName, n: sql<number>`count(*)::int`, views: sql<number>`count(*) filter (where ${inArray(auditEvents.action, [...ACCESS_ACTIONS])})::int` })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(where)
    .groupBy(auditEvents.actorUserId, users.title, users.firstName, users.lastName)
    .orderBy(desc(sql`count(*)`))
    .limit(10);
  const denials = await tx
    .select({ event: auditEvents, actor: users })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(and(where, eq(auditEvents.outcome, "denied")))
    .orderBy(desc(auditEvents.createdAt))
    .limit(20);
  return {
    totals: totals ?? { events: 0, denied: 0, critical: 0, warnings: 0, recordViews: 0, failedSignIns: 0, people: 0 },
    perDay,
    topActions: topActions.map((a) => ({ ...a, category: categoryOf(a.action) })),
    topPeople: topPeople.map((p) => ({ actorId: p.actorId, name: p.firstName ? staffName({ title: p.title, firstName: p.firstName, lastName: p.lastName ?? "" }) : "System / signed out", events: p.n, views: p.views })),
    denials: denials.map((d) => ({
      id: d.event.id,
      createdAt: d.event.createdAt,
      action: d.event.action,
      actorName: d.actor ? staffName(d.actor) : null,
      details: redactDetails(d.event.action, d.event.details),
    })),
  };
}
