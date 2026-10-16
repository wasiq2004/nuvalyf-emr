// Creates a platform (Super Admin) operator account.
//   npm run db:create-platform-admin -- <email> <password>
//   or set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD
import { ensurePlatformAdmin, ownerConnection } from "./tasks";

async function main() {
  const [argEmail, argPassword] = process.argv.slice(2);
  const email = argEmail ?? process.env.PLATFORM_ADMIN_EMAIL;
  const password = argPassword ?? process.env.PLATFORM_ADMIN_PASSWORD;
  if (!email || !password) {
    console.error("Usage: npm run db:create-platform-admin -- <email> <password>");
    process.exit(1);
  }

  const sql = ownerConnection();
  try {
    await ensurePlatformAdmin(sql, { email, password });
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("✗ Could not create platform admin:", error instanceof Error ? error.message : error);
  process.exit(1);
});
