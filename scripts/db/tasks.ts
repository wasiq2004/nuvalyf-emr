// Database tasks for CLI scripts (run with tsx, outside Next.js).
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { hash } from "@node-rs/argon2";

dotenv.config({ path: [".env.local", ".env"], quiet: true });

export type Sql = ReturnType<typeof postgres>;

const ROLE_URLS = [
  { role: "medflow_app", env: "DATABASE_URL", required: true },
  { role: "medflow_platform", env: "PLATFORM_DATABASE_URL", required: true },
  { role: "medflow_provisioner", env: "PROVISIONER_DATABASE_URL", required: false },
] as const;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`✗ ${name} is not set. See .env.example.`);
    process.exit(1);
  }
  return value;
}

export function ownerConnection(): Sql {
  return postgres(requireEnv("DATABASE_OWNER_URL"), {
    max: 1,
    onnotice: () => {},
    ssl: process.env.DATABASE_SSL === "require" ? "require" : false,
  });
}

/**
 * Creates the database named in DATABASE_OWNER_URL if it does not exist.
 * The postgres image only creates POSTGRES_DB on an empty volume, so a reused
 * volume (or a fresh managed server) can be missing it. Never drops anything.
 */
export async function ensureDatabase() {
  const url = new URL(requireEnv("DATABASE_OWNER_URL"));
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(database)) {
    throw new Error(`Database name "${database}" must be lowercase letters, digits and underscores`);
  }
  url.pathname = "/postgres";
  const admin = postgres(url.toString(), {
    max: 1,
    onnotice: () => {},
    ssl: process.env.DATABASE_SSL === "require" ? "require" : false,
  });
  try {
    const [exists] = await admin`select 1 from pg_database where datname = ${database}`;
    if (!exists) {
      await admin.unsafe(`CREATE DATABASE "${database}"`);
      console.log(`✓ Database ${database} created`);
    }
  } catch (error) {
    // No access to the maintenance database (some managed hosts): the
    // database must then already exist, and the next step will say if not.
    if (error instanceof Error && /CREATE DATABASE|permission denied to create/i.test(error.message)) throw error;
  } finally {
    await admin.end();
  }
}

/**
 * Creates/updates the runtime login roles from the credentials in their
 * connection strings. Roles never get SUPERUSER or BYPASSRLS.
 */
export async function ensureRoles(sql: Sql) {
  for (const { role, env, required } of ROLE_URLS) {
    const url = process.env[env];
    if (!url) {
      if (required) throw new Error(`${env} is not set`);
      console.log(`• ${env} not set; ${role} login disabled (onboarding and admin rescue will be unavailable)`);
      continue;
    }

    const parsed = new URL(url);
    const user = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));

    if (user !== role) {
      throw new Error(`${env} must connect as "${role}" (found "${user}")`);
    }
    if (!password) throw new Error(`${env} must include a password`);

    const [exists] = await sql`select 1 from pg_roles where rolname = ${role}`;
    const verb = exists ? "ALTER" : "CREATE";
    await sql.unsafe(
      `${verb} ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${password.replace(/'/g, "''")}'`,
    );
    await sql.unsafe(`GRANT CONNECT ON DATABASE "${database.replace(/"/g, '""')}" TO ${role}`);
    console.log(`✓ Role ${role} ready`);
  }
}

export async function runMigrations(sql: Sql) {
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "db", "migrations") });
  console.log("✓ Schema migrations applied");

  await sql.unsafe(fs.readFileSync(path.join(process.cwd(), "db", "sql", "views.sql"), "utf-8"));
  await sql.unsafe(fs.readFileSync(path.join(process.cwd(), "db", "sql", "security.sql"), "utf-8"));
  console.log("✓ Views and security policies applied");
}

/** Development/test only: drops every NuvaLyf schema. */
export async function resetDatabase(sql: Sql) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DESTRUCTIVE_RESET !== "true") {
    throw new Error("Refusing to reset a production database (set ALLOW_DESTRUCTIVE_RESET=true to override)");
  }
  await sql.unsafe(`
    DROP SCHEMA IF EXISTS app CASCADE;
    DROP SCHEMA IF EXISTS platform CASCADE;
    DROP SCHEMA IF EXISTS sys CASCADE;
    DROP SCHEMA IF EXISTS drizzle CASCADE;
  `);
  console.log("✓ Database reset");
}

export async function ensurePlatformAdmin(
  sql: Sql,
  input: { email: string; password: string; name?: string },
) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Platform admin email is invalid");
  if (input.password.length < 12) throw new Error("Platform admin password must be at least 12 characters");

  const existing = await sql`select id from platform.operators where lower(email) = ${email}`;
  if (existing.length > 0) {
    console.log(`✓ Platform admin ${email} already exists; left unchanged`);
    return;
  }

  const passwordHash = await hash(input.password);
  await sql`
    insert into platform.operators (email, name, password_hash, role, must_change_password)
    values (${email}, ${input.name ?? "Platform Admin"}, ${passwordHash}, 'platform_admin', false)
  `;
  console.log(`✓ Created platform admin ${email}`);
}
