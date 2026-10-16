// Creates an administrator account.
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run db:create-admin
//   npm run db:create-admin -- admin@clinic.com 'a-long-password'
import { connect, ensureAdmin } from "./lib/db-tasks";

async function main() {
  const [argEmail, argPassword] = process.argv.slice(2);
  const email = argEmail ?? process.env.ADMIN_EMAIL;
  const password = argPassword ?? process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("Usage: npm run db:create-admin -- <email> <password>");
    console.error("   or: set ADMIN_EMAIL and ADMIN_PASSWORD");
    process.exit(1);
  }

  const sql = connect();
  try {
    await ensureAdmin(sql, { email, password });
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("✗ Could not create admin:", error instanceof Error ? error.message : error);
  process.exit(1);
});
