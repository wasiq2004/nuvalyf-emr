// Clears a console operator's two-step sign-in, for when the only Platform
// Admin has lost their phone and recovery codes. Needs server access and the
// database owner, so it is not a way around the console. Recorded in the
// platform audit trail.
//
//   npm run db:reset-operator-mfa -- admin@example.com
import { ownerConnection } from "./tasks";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Usage: npm run db:reset-operator-mfa -- <operator email>");
  const sql = ownerConnection();
  try {
    const rows = await sql<{ id: string }[]>`
      update platform.operators
      set mfa_secret = null, mfa_pending_secret = null, mfa_enabled_at = null, mfa_last_step = null,
          mfa_recovery_hashes = '[]'::jsonb, session_version = session_version + 1, updated_at = now()
      where lower(email) = ${email}
      returning id`;
    if (rows.length === 0) throw new Error(`No operator with the email ${email}.`);
    await sql`insert into platform.audit_events (operator_id, action, target_type, target_id, details)
              values (null, 'OPERATOR_MFA_RESET', 'operator', ${rows[0].id}, ${sql.json({ email, by: "command line" })})`;
    console.log(`✓ Two-step sign-in cleared for ${email}. They set it up again at their next sign-in.`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
