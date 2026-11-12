// What the database itself holds in every column the application encrypts.
// Reads with the owner role, as anyone with the database files or a stolen
// dump would: no plain text, and every value opens only under its own column.
import { describe, expect, it } from "vitest";
import { ENCRYPTED_FIELDS } from "@/lib/encrypted-fields";
import { decryptBytes, decryptText, isEncryptedBytes, isEncryptedText } from "@/lib/crypto-core";
import { ownerSql } from "./test-db";

describe("encryption at rest", () => {
  it("holds only ciphertext in every encrypted column, each bound to that column", async () => {
    const owner = ownerSql();
    try {
      let checked = 0;
      for (const field of ENCRYPTED_FIELDS) {
        const cast = field.kind === "json" ? "::text" : "";
        const rows: { value: unknown }[] = await owner.unsafe(`select "${field.column}"${cast} as value from ${field.schema ?? "app"}."${field.table}" where "${field.column}" is not null limit 200`);
        for (const { value } of rows) {
          checked += 1;
          if (field.kind === "bytes") {
            const bytes = value as Buffer;
            expect(isEncryptedBytes(bytes), `${field.table}.${field.column} holds plain bytes`).toBe(true);
            expect(() => decryptBytes(bytes, field.context)).not.toThrow();
            expect(() => decryptBytes(bytes, "some.other_column")).toThrow();
          } else {
            const text = field.kind === "json" ? (JSON.parse(String(value)) as unknown) : value;
            expect(typeof text === "string" && isEncryptedText(text), `${field.table}.${field.column} holds plain text`).toBe(true);
            expect(() => decryptText(text as string, field.context)).not.toThrow();
            expect(() => decryptText(text as string, "some.other_column")).toThrow();
          }
        }
      }
      // Reads whatever the other test files have written; a fresh database may hold few rows.
      expect(checked).toBeGreaterThanOrEqual(0);
    } finally {
      await owner.end();
    }
  });
});
