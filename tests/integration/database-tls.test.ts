// Connections to the database are encrypted and the server is verified.
// Runs only against a database set up for TLS (DATABASE_SSL=verify-full);
// docs/OPERATIONS.md "Database TLS" describes that setup.
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { databaseSsl } from "@/lib/db/ssl";
import { testUrls } from "./test-db";

const tls = process.env.DATABASE_SSL === "verify-full";

describe.skipIf(!tls)("database TLS", () => {
  const url = testUrls().owner;
  const attempt = async (ssl: postgres.Options<Record<string, never>>["ssl"], host?: string) => {
    const sql = postgres(url, { max: 1, onnotice: () => {}, ssl, connect_timeout: 5, ...(host ? { host } : {}) });
    try {
      const [row] = await sql`select ssl, version, cipher from pg_stat_ssl where pid = pg_backend_pid()`;
      return row as { ssl: boolean; version: string; cipher: string };
    } finally {
      await sql.end({ timeout: 1 });
    }
  };

  it("encrypts the app's connection, with TLS 1.2 or later", async () => {
    const row = await attempt(databaseSsl(url));
    expect(row.ssl).toBe(true);
    expect(["TLSv1.2", "TLSv1.3"]).toContain(row.version);
  });

  it("refuses a connection without TLS", async () => {
    await expect(attempt(false)).rejects.toThrow(/no encryption|pg_hba|rejects connection/i);
  });

  it("refuses a server whose certificate our CA did not sign", async () => {
    const stranger = process.env.TEST_FOREIGN_CA;
    expect(stranger, "TEST_FOREIGN_CA must point at an unrelated CA certificate").toBeTruthy();
    await expect(attempt(databaseSsl(url, { ...process.env, DATABASE_SSL_CA: stranger }))).rejects.toThrow(/self[- ]signed|unable to verify|certificate/i);
  });

  it("refuses a server reached by a name its certificate does not carry", async () => {
    // The certificate names localhost and 127.0.0.1; ::1 reaches the same server but is not named.
    const host = process.env.TEST_UNNAMED_HOST;
    expect(host, "TEST_UNNAMED_HOST must reach this database by a name the certificate lacks").toBeTruthy();
    await expect(attempt(databaseSsl(`postgres://x@[${host}]/x`), host)).rejects.toThrow(/altnames|hostname|does not match|ERR_TLS_CERT_ALTNAME_INVALID/i);
  });
});
