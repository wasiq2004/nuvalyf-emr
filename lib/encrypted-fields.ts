// Every column NuvaLyf encrypts in the application, in one place. Key rotation
// (scripts/ops/rotate-key.ts) and the encryption of rows written before a
// column was encrypted both work from this list, so a column added here is
// covered by both.
//
// `guarded`: the table's triggers refuse updates (append-only documents, signed
// records). Rewriting their ciphertext is the one change allowed, done by the
// rotation script as the database owner with triggers suspended for that
// statement only; the plain text is never changed.
export type EncryptedField = {
  /** Postgres schema; "app" unless stated. */
  schema?: "app" | "platform";
  table: string;
  column: string;
  /** The table's key column. */
  key: string;
  kind: "text" | "bytes" | "json";
  /** Bound into every ciphertext: a value moved to another column will not decrypt. */
  context: string;
  guarded: boolean;
};

const field = (table: string, column: string, kind: EncryptedField["kind"] = "text", guarded = true): EncryptedField => ({ table, column, key: "id", kind, context: `${table}.${column}`, guarded });

export const ENCRYPTED_FIELDS: EncryptedField[] = [
  { table: "whatsapp_config", column: "access_token_encrypted", key: "clinic_id", kind: "text", context: "whatsapp_config.access_token_encrypted", guarded: false },
  // Consultation notes, locked once the consultation is signed.
  field("encounters", "chief_complaint"),
  field("encounters", "history"),
  field("encounters", "examination"),
  field("encounters", "plan"),
  field("encounters", "nursing_notes"),
  field("vitals", "notes"),
  field("encounter_amendments", "text"),
  field("private_notes", "text"),
  field("lab_orders", "notes"),
  field("lab_orders", "result_notes"),
  { ...field("lab_document_files", "content", "bytes"), key: "document_id" },
  field("prescription_queries", "message"),
  field("prescription_queries", "response"),
  field("discharge_summaries", "sections", "json"),
  // Two-step sign-in secrets.
  field("users", "mfa_secret", "text", false),
  field("users", "mfa_pending_secret", "text", false),
  { ...field("operators", "mfa_secret", "text", false), schema: "platform" },
  { ...field("operators", "mfa_pending_secret", "text", false), schema: "platform" },
];
