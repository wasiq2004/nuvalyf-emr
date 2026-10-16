// Creates or upgrades the database schema. Safe to run repeatedly.
import { applySchema, connect } from "./lib/db-tasks";

async function main() {
  const sql = connect();
  try {
    await applySchema(sql);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("✗ Schema initialization failed:", error);
  process.exit(1);
});
