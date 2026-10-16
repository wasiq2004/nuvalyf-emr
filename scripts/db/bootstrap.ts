// One-shot setup before the app starts (docker compose "setup" service):
//   1. roles + migrations + security policies (idempotent)
//   2. platform admin from PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD, if set
// Never deletes data.
import { ensureDatabase, ensurePlatformAdmin, ensureRoles, ownerConnection, runMigrations } from "./tasks";

async function main() {
  await ensureDatabase();
  const sql = ownerConnection();
  try {
    await ensureRoles(sql);
    await runMigrations(sql);

    const { PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD } = process.env;
    if (PLATFORM_ADMIN_EMAIL && PLATFORM_ADMIN_PASSWORD) {
      await ensurePlatformAdmin(sql, { email: PLATFORM_ADMIN_EMAIL, password: PLATFORM_ADMIN_PASSWORD });
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("✗ Bootstrap failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
