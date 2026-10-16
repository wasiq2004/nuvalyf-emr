// Database access for the running app.
//
// Three connection pools, one per Postgres role (see db/sql/security.sql):
//   appDb()         medflow_app         clinic + compliance panels (RLS enforced)
//   platformDb()    medflow_platform    operations console (no clinical grants)
//   provisionerDb() medflow_provisioner onboarding + admin rescue only (optional)
//
// Clinic data must be accessed through withClinic(), which sets the RLS
// context inside a transaction so it can never leak to another request.
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything queries can run on: a pool or an open transaction. */
export type Queryable = Database | Tx;

type PoolName = "app" | "platform" | "provisioner";

const URL_ENV: Record<PoolName, string> = {
  app: "DATABASE_URL",
  platform: "PLATFORM_DATABASE_URL",
  provisioner: "PROVISIONER_DATABASE_URL",
};

type Pool = { client: ReturnType<typeof postgres>; db: Database; checked?: Promise<void> };

// Reuse pools across hot reloads in development.
const globalPools = globalThis as unknown as { medflowPools?: Partial<Record<PoolName, Pool>> };
const pools: Partial<Record<PoolName, Pool>> = (globalPools.medflowPools ??= {});

function createPool(name: PoolName, url: string): Pool {
  const client = postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: process.env.DATABASE_SSL === "require" ? "require" : false,
    onnotice: () => {},
    connection: { application_name: `medflow-${name}` },
  });
  return { client, db: drizzle(client, { schema }) };
}

function getPool(name: PoolName): Pool | null {
  const existing = pools[name];
  if (existing) return existing;

  const url = process.env[URL_ENV[name]];
  if (!url) return null;

  const pool = createPool(name, url);
  pools[name] = pool;
  return pool;
}

/**
 * Refuses to run against a role that would silently bypass row-level
 * security (superuser or BYPASSRLS). Checked once per pool.
 */
function assertSafeRole(name: PoolName, pool: Pool): Promise<void> {
  pool.checked ??= (async () => {
    const [row] = await pool.db.execute<{ rolsuper: boolean; rolbypassrls: boolean; rolname: string }>(
      sql`select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    if (row?.rolsuper || row?.rolbypassrls) {
      throw new Error(
        `${URL_ENV[name]} connects as "${row.rolname}", which bypasses row-level security. ` +
          `Use the dedicated medflow_${name} role.`,
      );
    }
  })();
  return pool.checked;
}

function requirePool(name: PoolName): Pool {
  const pool = getPool(name);
  if (!pool) {
    throw new Error(`${URL_ENV[name]} is not set`);
  }
  return pool;
}

export function appDb(): Database {
  return requirePool("app").db;
}

export function platformDb(): Database {
  return requirePool("platform").db;
}

/** Null when PROVISIONER_DATABASE_URL is not configured: the dependent features switch off. */
export function provisionerDb(): Database | null {
  return getPool("provisioner")?.db ?? null;
}

export function isProvisionerConfigured(): boolean {
  return Boolean(process.env.PROVISIONER_DATABASE_URL);
}

export type ClinicScope = { clinicId: string; userId?: string | null };

/**
 * Runs `fn` in a transaction scoped to one clinic. Row-level security limits
 * every query inside it to that clinic's rows.
 */
export async function withClinic<T>(scope: ClinicScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const pool = requirePool("app");
  await assertSafeRole("app", pool);

  return pool.db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.clinic_id', ${scope.clinicId}, true), set_config('app.user_id', ${scope.userId ?? ""}, true)`,
    );
    return fn(tx);
  });
}

/** Platform-console queries. */
export async function withPlatform<T>(fn: (db: Database) => Promise<T>): Promise<T> {
  const pool = requirePool("platform");
  await assertSafeRole("platform", pool);
  return fn(pool.db);
}

/** Onboarding / rescue. Throws if the provisioner connection is not configured. */
export async function withProvisioner<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const pool = requirePool("provisioner");
  await assertSafeRole("provisioner", pool);
  return pool.db.transaction(fn);
}

/** Queries that are not clinic data (rate limits, health). */
export async function withAppConnection<T>(fn: (db: Database) => Promise<T>): Promise<T> {
  const pool = requirePool("app");
  await assertSafeRole("app", pool);
  return fn(pool.db);
}

export { schema };
