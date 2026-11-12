// The application's encryption keys. Deliberately free of "server-only" so the
// startup check (instrumentation.ts), the worker and the ops scripts can load it.
//
//   DATA_ENCRYPTION_KEY       the current key: 32 random bytes, base64. Every
//                             new value is encrypted with it.
//   DATA_ENCRYPTION_KEYS_OLD  earlier keys, comma-separated, kept only while
//                             `npm run ops:rotate-key` re-encrypts their values.
//
// A key is identified by the first 8 hex characters of its SHA-256, stored
// with each value, so the right key is found without trying them all and a
// value under an unknown key is reported as such.
import { createHash } from "crypto";

export type Key = { id: string; bytes: Buffer };
type Env = Record<string, string | undefined>;

export function keyId(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 8);
}

function parseKey(raw: string, name: string): Key {
  const bytes = Buffer.from(raw.trim(), "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== raw.trim()) throw new Error(`${name} must be 32 random bytes in base64 (openssl rand -base64 32).`);
  return { id: keyId(bytes), bytes };
}

export type Keyring = { current: Key | null; all: Key[] };

export function loadKeyring(env: Env = process.env): Keyring {
  const raw = env.DATA_ENCRYPTION_KEY?.trim();
  const current = raw ? parseKey(raw, "DATA_ENCRYPTION_KEY") : null;
  const old = (env.DATA_ENCRYPTION_KEYS_OLD ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k, i) => parseKey(k, `DATA_ENCRYPTION_KEYS_OLD[${i}]`));
  const all = [...(current ? [current] : []), ...old];
  if (new Set(all.map((k) => k.id)).size !== all.length) throw new Error("DATA_ENCRYPTION_KEYS_OLD repeats a key, or contains the current one.");
  return { current, all };
}

/**
 * Called once at startup. In production a missing or malformed key stops the
 * server, rather than surfacing later as records that cannot be read or saved.
 */
export function assertKeyring(env: Env = process.env): Keyring {
  const ring = loadKeyring(env);
  if (!ring.current && env.NODE_ENV === "production") {
    throw new Error("DATA_ENCRYPTION_KEY is not set. Patient documents and notes are encrypted with it; the server will not start without it (docs/OPERATIONS.md).");
  }
  return ring;
}
