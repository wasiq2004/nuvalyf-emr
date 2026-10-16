// Loads demo data into an EMPTY database.
//   npm run db:seed           -> skips if any users exist
//   npm run db:seed -- --reset -> deletes ALL data first (blocked in production)
import { connect, seedDemoData } from "./lib/db-tasks";

async function main() {
  const reset = process.argv.includes("--reset");
  const sql = connect();
  try {
    await seedDemoData(sql, { reset });
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("✗ Seeding failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
