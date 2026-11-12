// How every connection to Postgres is encrypted: the app, the worker, the
// migration and ops scripts, and the tests all read the same setting.
//
//   DATABASE_SSL=verify-full  TLS, and the server's certificate must be signed
//                             by DATABASE_SSL_CA and name the host connected to.
//                             What a licensed deployment uses.
//   DATABASE_SSL=require      TLS without checking who answered. Only for a
//                             managed database that gives no CA certificate.
//   DATABASE_SSL=disable      No TLS. Development and CI only.
//
// In production an unset value is refused rather than quietly meaning "no
// encryption": a plain connection has to be asked for by name.
import fs from "fs";

export type DatabaseSsl = false | "require" | { ca: string; rejectUnauthorized: true; minVersion: "TLSv1.2"; host?: string };

type Env = Record<string, string | undefined>;

const MODES = ["verify-full", "require", "disable"] as const;
export type DatabaseSslMode = (typeof MODES)[number];

export function databaseSslMode(env: Env = process.env): DatabaseSslMode {
  const raw = (env.DATABASE_SSL ?? "").trim().toLowerCase();
  if (raw === "") {
    if (env.NODE_ENV === "production") {
      throw new Error("DATABASE_SSL is not set. Use verify-full with DATABASE_SSL_CA (docs/OPERATIONS.md). To run without encryption, set DATABASE_SSL=disable explicitly.");
    }
    return "disable";
  }
  if (!(MODES as readonly string[]).includes(raw)) throw new Error(`DATABASE_SSL must be one of ${MODES.join(", ")}; got "${raw}".`);
  return raw as DatabaseSslMode;
}

/** The host a connection string points at ("db", "10.0.0.5", "::1"). */
export function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname;
    return host.replace(/^\[|\]$/g, "") || undefined;
  } catch {
    return undefined;
  }
}

/**
 * TLS options for a connection to `url`. The host is passed on so the
 * certificate is checked against it even when it is an IP address: the driver
 * sends no server name for an IP, and Node would otherwise check the
 * certificate against "localhost".
 */
export function databaseSsl(url?: string, env: Env = process.env, read: (path: string) => string = (p) => fs.readFileSync(p, "utf8")): DatabaseSsl {
  const mode = databaseSslMode(env);
  if (mode === "disable") return false;
  if (mode === "require") return "require";
  const caPath = env.DATABASE_SSL_CA?.trim();
  if (!caPath) throw new Error("DATABASE_SSL=verify-full needs DATABASE_SSL_CA: the path to the CA certificate that signed the database's certificate.");
  let ca: string;
  try {
    ca = read(caPath);
  } catch {
    throw new Error(`Cannot read DATABASE_SSL_CA at ${caPath}.`);
  }
  if (!ca.includes("BEGIN CERTIFICATE")) throw new Error(`DATABASE_SSL_CA at ${caPath} is not a PEM certificate.`);
  // Node checks the certificate chain and that the certificate names the host.
  const host = hostOf(url);
  return host ? { ca, rejectUnauthorized: true, minVersion: "TLSv1.2", host } : { ca, rejectUnauthorized: true, minVersion: "TLSv1.2" };
}
