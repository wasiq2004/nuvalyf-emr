// Re-encrypts every encrypted value under the current key, and encrypts any
// value in an encrypted column that was written before the column was.
//
//   npm run ops:rotate-key            do it
//   npm run ops:rotate-key -- --check  only count what is not yet under the current key
//
// To rotate: set the new key as DATA_ENCRYPTION_KEY, move the old one into
// DATA_ENCRYPTION_KEYS_OLD, restart the app, run this, run it again with
// --check (it must report 0 everywhere), then remove the old key.
// Runs as the database owner (DATABASE_OWNER_URL). Batches of 200 rows, each
// in its own transaction, so it can be stopped and run again safely.
import dotenv from "dotenv";
import postgres from "postgres";
import { databaseSsl } from "../../lib/db/ssl";
import { assertKeyring } from "../../lib/keyring";
import { ENCRYPTED_FIELDS, type EncryptedField } from "../../lib/encrypted-fields";
import { bytesKeyId, currentKeyId, decryptBytes, decryptText, encryptBytes, encryptText, isEncryptedBytes, isEncryptedText, textKeyId } from "../../lib/crypto-core";

dotenv.config({ path: [".env.local", ".env"], quiet: true });

const BATCH = 200;
const check = process.argv.includes("--check");

/**
 * A jsonb value arrives as its text: an encrypted one is a JSON string holding
 * the ciphertext. Extra layers of quoting (from an earlier faulty write) are
 * unwrapped, never encrypted again.
 */
function jsonCipher(value: unknown): string | null {
  let parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  for (let i = 0; i < 3 && typeof parsed === "string" && !isEncryptedText(parsed) && parsed.startsWith('"'); i++) parsed = JSON.parse(parsed);
  return typeof parsed === "string" && isEncryptedText(parsed) ? parsed : null;
}

function needsWork(field: EncryptedField, value: unknown, current: string): boolean {
  if (field.kind === "text") {
    const text = String(value);
    return !isEncryptedText(text) || textKeyId(text) !== current;
  }
  if (field.kind === "json") {
    const cipher = jsonCipher(value);
    // Also rewrite a value stored in anything but the one plain form.
    return cipher === null || textKeyId(cipher) !== current || String(value) !== JSON.stringify(cipher);
  }
  const bytes = value as Uint8Array;
  return !isEncryptedBytes(bytes) || bytesKeyId(bytes) !== current;
}

/** Plain text in an encrypted column is a row from before encryption: encrypt it as it is. */
function reseal(field: EncryptedField, value: unknown): unknown {
  if (field.kind === "json") {
    // The plain JSON, then its ciphertext as a bare string: the update wraps it with to_jsonb.
    const cipher = jsonCipher(value);
    const plain = cipher ? decryptText(cipher, field.context) : typeof value === "string" ? value : JSON.stringify(value);
    return encryptText(plain, field.context);
  }
  if (field.kind === "text") {
    const text = String(value);
    return encryptText(isEncryptedText(text) ? decryptText(text, field.context) : text, field.context);
  }
  const bytes = value as Uint8Array;
  return encryptBytes(isEncryptedBytes(bytes) ? decryptBytes(bytes, field.context) : bytes, field.context);
}

async function main() {
  const ring = assertKeyring();
  const current = currentKeyId();
  if (!ring.current || !current) throw new Error("DATA_ENCRYPTION_KEY is not set.");
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error("DATABASE_OWNER_URL is not set.");
  const sql = postgres(url, { max: 1, onnotice: () => {}, ssl: databaseSsl(url) });
  const [{ rolsuper }] = await sql<{ rolsuper: boolean }[]>`select rolsuper from pg_roles where rolname = current_user`;
  console.log(`${check ? "Checking" : "Re-encrypting"} under key ${current} (${ring.all.length - 1} older key(s) configured)`);

  let remaining = 0;
  for (const field of ENCRYPTED_FIELDS) {
    if (field.guarded && !check && !rolsuper) throw new Error(`${field.table} is append-only; rewriting its ciphertext needs the database owner (superuser).`);
    let done = 0;
    let left = 0;
    let after: string | null = null;
    for (;;) {
      const rows: { id: string; value: unknown }[] = await sql.unsafe(
        `select "${field.key}"::text as id, "${field.column}"${field.kind === "json" ? "::text" : ""} as value from ${field.schema ?? "app"}."${field.table}" where "${field.column}" is not null ${after ? `and "${field.key}"::text > $1` : ""} order by "${field.key}"::text limit ${BATCH}`,
        after ? [after] : [],
      );
      if (rows.length === 0) break;
      after = rows[rows.length - 1].id;
      const work = rows.filter((r) => needsWork(field, r.value, current));
      if (check) {
        left += work.length;
        continue;
      }
      if (work.length === 0) continue;
      await sql.begin(async (tx) => {
        // Triggers refuse any change to signed and append-only rows. This
        // rewrites ciphertext only, for this transaction only.
        if (field.guarded) await tx.unsafe("set local session_replication_role = replica");
        for (const row of work) {
          const target = field.kind === "json" ? "to_jsonb($1::text)" : "$1";
          await tx.unsafe(`update ${field.schema ?? "app"}."${field.table}" set "${field.column}" = ${target} where "${field.key}" = $2::uuid`, [reseal(field, row.value) as string, row.id]);
        }
      });
      done += work.length;
    }
    remaining += left;
    console.log(`  ${field.table}.${field.column}: ${check ? `${left} not under the current key` : `${done} re-encrypted`}`);
  }
  await sql.end();
  if (check && remaining > 0) {
    console.log(`${remaining} value(s) still need the old key. Run without --check.`);
    process.exit(2);
  }
  console.log(check ? "Every value is under the current key. Older keys can be removed." : "Done.");
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
