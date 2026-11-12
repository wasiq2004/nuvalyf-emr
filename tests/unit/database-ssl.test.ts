// How DATABASE_SSL is read: production never ends up unencrypted by accident.
import { describe, expect, it } from "vitest";
import { databaseSsl, databaseSslMode, hostOf } from "@/lib/db/ssl";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
const read = (files: Record<string, string>) => (p: string) => {
  if (!(p in files)) throw new Error("ENOENT");
  return files[p];
};

describe("database TLS setting", () => {
  it("refuses to guess in production", () => {
    expect(() => databaseSslMode({ NODE_ENV: "production" })).toThrow(/DATABASE_SSL is not set/);
    expect(() => databaseSsl("postgres://u@db/x", { NODE_ENV: "production" })).toThrow(/DATABASE_SSL is not set/);
  });

  it("allows a plain connection in production only when asked for by name", () => {
    expect(databaseSsl(undefined, { NODE_ENV: "production", DATABASE_SSL: "disable" })).toBe(false);
  });

  it("defaults to no TLS outside production", () => {
    expect(databaseSsl(undefined, { NODE_ENV: "test" })).toBe(false);
  });

  it("verifies the server against the CA with verify-full, at TLS 1.2 or later", () => {
    const env = { DATABASE_SSL: "verify-full", DATABASE_SSL_CA: "/certs/ca.crt" };
    const files = read({ "/certs/ca.crt": PEM });
    expect(databaseSsl("postgres://medflow_app:x@db:5432/medflow", env, files)).toEqual({ ca: PEM, rejectUnauthorized: true, minVersion: "TLSv1.2", host: "db" });
  });

  it("checks the certificate against the host connected to, IP addresses included", () => {
    expect(hostOf("postgres://u:p@10.0.0.5:5432/medflow")).toBe("10.0.0.5");
    expect(hostOf("postgres://u:p@[::1]:5432/medflow")).toBe("::1");
    expect(hostOf("not a url")).toBeUndefined();
  });

  it("will not verify-full without a readable PEM CA", () => {
    expect(() => databaseSsl(undefined, { DATABASE_SSL: "verify-full" })).toThrow(/needs DATABASE_SSL_CA/);
    expect(() => databaseSsl(undefined, { DATABASE_SSL: "verify-full", DATABASE_SSL_CA: "/nope" }, read({}))).toThrow(/Cannot read/);
    expect(() => databaseSsl(undefined, { DATABASE_SSL: "verify-full", DATABASE_SSL_CA: "/k" }, read({ "/k": "-----BEGIN PRIVATE KEY-----" }))).toThrow(/not a PEM certificate/);
  });

  it("rejects a mistyped mode instead of ignoring it", () => {
    expect(() => databaseSslMode({ DATABASE_SSL: "verify_full" })).toThrow(/must be one of/);
    expect(databaseSslMode({ DATABASE_SSL: " Require " })).toBe("require");
  });
});
