// Development only: drops all NuvaLyf schemas, then re-runs migrations.
import { ensureRoles, ownerConnection, resetDatabase, runMigrations } from "./tasks";

async function main() {
  const sql = ownerConnection();
  try {
    await resetDatabase(sql);
    await ensureRoles(sql);
    await runMigrations(sql);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("✗ Reset failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
