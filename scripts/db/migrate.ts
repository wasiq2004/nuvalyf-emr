// Creates/updates DB roles, applies schema migrations and security policies.
// Safe to run on every deploy.
import { ensureDatabase, ensureRoles, ownerConnection, runMigrations } from "./tasks";

async function main() {
  await ensureDatabase();
  const sql = ownerConnection();
  try {
    await ensureRoles(sql);
    await runMigrations(sql);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("✗ Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
