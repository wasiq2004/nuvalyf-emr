// Columns encrypted in the application (lib/crypto-core.ts, AES-256-GCM).
//
// Values are encrypted as they are written and decrypted as they are read, so
// services and screens see plain text. The database, its files and its
// backups only ever hold ciphertext. Each column binds its own name into the
// ciphertext: a value copied into another column will not decrypt.
//
// A value written before its column was encrypted is still read as written;
// `npm run ops:rotate-key` encrypts those rows (lib/encrypted-fields.ts).
//
// Rules for code using these columns: never filter or sort on them in SQL
// (each encryption is different, so equal texts never compare equal), and
// read them through Drizzle, not raw SQL.
import { customType } from "drizzle-orm/pg-core";
import { decryptBytes, decryptText, encryptBytes, encryptText, isEncryptedBytes, isEncryptedText } from "../../crypto-core";

export function encryptedText(table: string, column: string) {
  const context = `${table}.${column}`;
  return customType<{ data: string; driverData: string }>({
    dataType: () => "text",
    toDriver: (value) => encryptText(value, context),
    fromDriver: (value) => (isEncryptedText(value) ? decryptText(value, context) : value),
  })(column);
}

export function encryptedBytes(table: string, column: string) {
  const context = `${table}.${column}`;
  return customType<{ data: Buffer; driverData: Buffer }>({
    dataType: () => "bytea",
    toDriver: (value) => encryptBytes(value, context),
    fromDriver: (value) => {
      const buf = Buffer.from(value);
      return isEncryptedBytes(buf) ? decryptBytes(buf, context) : buf;
    },
  })(column);
}

/**
 * A jsonb column whose whole value is encrypted: stored as a JSON string
 * holding the ciphertext, so the column type and constraints stay as they are.
 */
export function encryptedJson<T>(table: string, column: string) {
  const context = `${table}.${column}`;
  return customType<{ data: T; driverData: string }>({
    dataType: () => "jsonb",
    toDriver: (value) => JSON.stringify(encryptText(JSON.stringify(value), context)),
    fromDriver: (value) => {
      // Depending on the connection, jsonb arrives as JSON text ('"v2:..."')
      // or already parsed (v2:...). Older rows hold the plain JSON.
      let parsed: unknown = value;
      for (let i = 0; i < 3 && typeof parsed === "string" && !isEncryptedText(parsed); i++) parsed = JSON.parse(parsed);
      if (typeof parsed === "string" && isEncryptedText(parsed)) return JSON.parse(decryptText(parsed, context)) as T;
      return parsed as T;
    },
  })(column);
}
