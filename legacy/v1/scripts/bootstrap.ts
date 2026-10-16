// One-shot setup run before the app starts (used by docker compose):
//   1. apply the schema (idempotent)
//   2. if SEED_DEMO_DATA=true, load demo data into an empty database
//   3. if ADMIN_EMAIL and ADMIN_PASSWORD are set, ensure that admin exists
// It never deletes data.
import { applySchema, connect, ensureAdmin, seedDemoData } from "./lib/db-tasks";

async function main() {
  const sql = connect();
  try {
    await applySchema(sql);

    if (process.env.SEED_DEMO_DATA === "true") {
      await seedDemoData(sql, { reset: false });
    }

    const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
    if (ADMIN_EMAIL && ADMIN_PASSWORD) {
      await ensureAdmin(sql, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("✗ Bootstrap failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
