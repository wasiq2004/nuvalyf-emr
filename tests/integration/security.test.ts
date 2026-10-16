// Phase 0 guarantees, proven against a real Postgres:
//   - one clinic can never read, change or reference another clinic's rows
//   - the platform role has no access to clinic data
//   - audit trails are append-only, even for the owner role
//   - the app refuses to run as a role that bypasses RLS
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { connect, ownerSql, testUrls } from "./test-db";
import { withAppConnection, withClinic } from "@/lib/db";
import { users } from "@/lib/db/schema";

const owner = ownerSql();

type Fixture = { clinicId: string; userId: string; roleId: string };
let clinicA: Fixture;
let clinicB: Fixture;

async function createClinic(code: string): Promise<Fixture> {
  const [clinic] = await owner`insert into platform.clinics (name, code) values (${code}, ${code}) returning id`;
  const [user] = await owner`
    insert into app.users (clinic_id, email, password_hash, first_name, last_name)
    values (${clinic.id}, ${`staff@${code}.test`}, 'x', 'Staff', ${code}) returning id`;
  const [role] = await owner`
    insert into app.roles (clinic_id, key, name) values (${clinic.id}, 'doctor', 'Doctor') returning id`;
  return { clinicId: clinic.id, userId: user.id, roleId: role.id };
}

function pgCode(error: unknown): string | undefined {
  let current = error as { code?: string; cause?: unknown } | undefined;
  for (let i = 0; i < 4 && current; i++) {
    if (current.code && /^[0-9A-Z]{5}$/.test(current.code)) return current.code;
    current = current.cause as typeof current;
  }
  return undefined;
}

async function expectPgError(promise: Promise<unknown>, code: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected Postgres error ${code}`).toBeDefined();
  expect(pgCode(caught)).toBe(code);
}

beforeAll(async () => {
  clinicA = await createClinic(`clinic-a-${Date.now()}`);
  clinicB = await createClinic(`clinic-b-${Date.now()}`);
});

afterAll(async () => {
  await owner.end();
});

describe("clinic isolation (row-level security)", () => {
  it("only returns the current clinic's rows", async () => {
    const rows = await withClinic({ clinicId: clinicA.clinicId }, (tx) => tx.select().from(users));
    expect(rows.map((r) => r.id)).toEqual([clinicA.userId]);
  });

  it("returns nothing when no clinic context is set", async () => {
    const rows = await withAppConnection((db) => db.select().from(users));
    expect(rows).toHaveLength(0);
  });

  it("cannot count another clinic's rows", async () => {
    const [row] = await withClinic({ clinicId: clinicA.clinicId }, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from app.users where clinic_id = ${clinicB.clinicId}`),
    );
    expect(row.n).toBe(0);
  });

  it("cannot update or delete another clinic's rows", async () => {
    const updated = await withClinic({ clinicId: clinicA.clinicId }, (tx) =>
      tx.execute(sql`update app.users set first_name = 'hacked' where id = ${clinicB.userId}`),
    );
    const deleted = await withClinic({ clinicId: clinicA.clinicId }, (tx) =>
      tx.execute(sql`delete from app.users where id = ${clinicB.userId}`),
    );
    expect(updated.count).toBe(0);
    expect(deleted.count).toBe(0);

    const [still] = await owner`select first_name from app.users where id = ${clinicB.userId}`;
    expect(still.first_name).toBe("Staff");
  });

  it("cannot insert rows into another clinic", async () => {
    await expectPgError(
      withClinic({ clinicId: clinicA.clinicId }, (tx) =>
        tx.insert(users).values({
          clinicId: clinicB.clinicId,
          email: "intruder@test",
          passwordHash: "x",
          firstName: "In",
          lastName: "Truder",
        }),
      ),
      "42501", // new row violates row-level security policy
    );
  });

  it("cannot reference another clinic's records through a foreign key", async () => {
    // Plain FK checks bypass RLS; composite (clinic_id, id) keys stop this.
    await expectPgError(
      withClinic({ clinicId: clinicA.clinicId }, (tx) =>
        tx.execute(
          sql`insert into app.user_roles (clinic_id, user_id, role_id) values (${clinicA.clinicId}, ${clinicA.userId}, ${clinicB.roleId})`,
        ),
      ),
      "23503",
    );
  });

  it("covers every table in the app schema with RLS and a tenant policy", async () => {
    const rows = await owner<{ table: string; rls: boolean; policies: number }[]>`
      select c.relname as table, c.relrowsecurity as rls,
             (select count(*)::int from pg_policies p where p.schemaname = 'app' and p.tablename = c.relname and p.policyname = 'tenant_isolation') as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relkind = 'r'`;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row, `app.${row.table}`).toMatchObject({ rls: true, policies: 1 });
    }
  });
});

describe("role separation", () => {
  it("platform role has no access to clinic tables", async () => {
    const platform = connect(testUrls().platform);
    try {
      await expectPgError(platform`select * from app.users`, "42501");
      await expectPgError(platform`select * from app.audit_events`, "42501");
    } finally {
      await platform.end();
    }
  });

  it("app role cannot read operator accounts or clinic contact details", async () => {
    const app = connect(testUrls().app);
    try {
      await expectPgError(app`select * from platform.operators`, "42501");
      await expectPgError(app`select contact_email from platform.clinics`, "42501");
      const clinics = await app`select id, code, status from platform.clinics`;
      expect(clinics.length).toBeGreaterThanOrEqual(2);
    } finally {
      await app.end();
    }
  });

  it("runtime roles cannot bypass RLS", async () => {
    const rows = await owner<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      select rolname, rolsuper, rolbypassrls from pg_roles
      where rolname in ('medflow_app', 'medflow_platform', 'medflow_provisioner')`;
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({ rolsuper: false, rolbypassrls: false });
    }
  });
});

describe("append-only audit trail", () => {
  it("lets the app record events", async () => {
    await withClinic({ clinicId: clinicA.clinicId, userId: clinicA.userId }, (tx) =>
      tx.execute(sql`insert into app.audit_events (clinic_id, actor_user_id, action) values (${clinicA.clinicId}, ${clinicA.userId}, 'TEST_EVENT')`),
    );
    const [row] = await owner`select count(*)::int as n from app.audit_events where action = 'TEST_EVENT'`;
    expect(row.n).toBe(1);
  });

  it("app role cannot change or delete events", async () => {
    await expectPgError(
      withClinic({ clinicId: clinicA.clinicId }, (tx) => tx.execute(sql`update app.audit_events set action = 'X'`)),
      "42501",
    );
    await expectPgError(
      withClinic({ clinicId: clinicA.clinicId }, (tx) => tx.execute(sql`delete from app.audit_events`)),
      "42501",
    );
  });

  it("even the owner role cannot update, delete or truncate events", async () => {
    // Row triggers only fire for affected rows, so make sure both tables have one.
    await owner`insert into platform.audit_events (action) values ('TEST_EVENT')`;
    await expectPgError(owner`update app.audit_events set action = 'X'`, "42501");
    await expectPgError(owner`delete from app.audit_events`, "42501");
    await expectPgError(owner`truncate app.audit_events`, "42501");
    await expectPgError(owner`delete from platform.audit_events`, "42501");
  });
});

describe("unsafe connection guard", () => {
  it("refuses to run the app as a superuser", async () => {
    const original = process.env.DATABASE_URL;
    const pools = (globalThis as unknown as { medflowPools: Record<string, unknown> }).medflowPools;
    const saved = pools.app;
    try {
      delete pools.app;
      process.env.DATABASE_URL = testUrls().owner;
      await expect(withClinic({ clinicId: clinicA.clinicId }, async () => 1)).rejects.toThrow(/bypasses row-level security/);
    } finally {
      process.env.DATABASE_URL = original;
      pools.app = saved;
    }
  });
});
