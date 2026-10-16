// Shared helpers for integration tests: a dedicated throwaway database.
import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config({ path: [".env.local", ".env"], quiet: true });

export const TEST_DB_NAME = "medflow_test";

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function requireUrl(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set to run integration tests`);
  return value;
}

/** Superuser connection to the server's maintenance database. */
export function adminUrl(): string {
  return process.env.TEST_DATABASE_ADMIN_URL ?? withDatabase(requireUrl("DATABASE_OWNER_URL"), "postgres");
}

/** Connection strings pointing at the throwaway test database. */
export function testUrls() {
  return {
    owner: withDatabase(adminUrl(), TEST_DB_NAME),
    app: withDatabase(requireUrl("DATABASE_URL"), TEST_DB_NAME),
    platform: withDatabase(requireUrl("PLATFORM_DATABASE_URL"), TEST_DB_NAME),
    provisioner: withDatabase(requireUrl("PROVISIONER_DATABASE_URL"), TEST_DB_NAME),
  };
}

export function connect(url: string) {
  return postgres(url, { max: 1, onnotice: () => {} });
}

/** Owner connection for seeding fixtures (bypasses RLS as table owner). */
export function ownerSql() {
  return connect(testUrls().owner);
}
