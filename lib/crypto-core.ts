// Application-level encryption: AES-256-GCM with keys from lib/keyring.ts.
//
// Each value carries the id of the key that encrypted it and is bound to a
// context (e.g. "lab_document_files.content"), passed as GCM associated data:
// a value copied into another column, or altered by one bit, fails to decrypt.
//
//   text   v2:<key id>:<iv>:<tag>:<ciphertext>     (base64 parts)
//   bytes  "NVE2" <key id, 4 bytes> <iv 12> <tag 16> <ciphertext>
//
// "v1:<iv>:<tag>:<ciphertext>" values (no key id, no context) from before key
// rotation still decrypt, and are rewritten as v2 by `npm run ops:rotate-key`.
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { AppError } from "./errors";
import { loadKeyring, type Key } from "./keyring";

const MAGIC = Buffer.from("NVE2");

function ring() {
  return loadKeyring();
}

function currentKey(): Key {
  const key = ring().current;
  if (!key) throw new AppError("This cannot be saved: DATA_ENCRYPTION_KEY is not set on the server.");
  return key;
}

function keyById(id: string): Key {
  const key = ring().all.find((k) => k.id === id);
  if (!key) throw new Error(`Encrypted with key ${id}, which is not configured. Add it to DATA_ENCRYPTION_KEYS_OLD.`);
  return key;
}

export function isEncryptionConfigured(): boolean {
  try {
    return ring().current !== null;
  } catch {
    return false;
  }
}

/** Id of the key new values are encrypted with, or null. */
export function currentKeyId(): string | null {
  return ring().current?.id ?? null;
}

function seal(key: Key, plain: Buffer, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.bytes, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), data };
}

function open(key: Key, iv: Buffer, tag: Buffer, data: Buffer, context: string | null): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key.bytes, iv);
  if (context !== null) decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

// --- text -------------------------------------------------------------------

// The exact shapes, so an old unencrypted note that happens to begin with
// "v2:" is never mistaken for ciphertext.
const B64 = "[A-Za-z0-9+/]+={0,2}";
const V2 = new RegExp(`^v2:[0-9a-f]{8}:${B64}:${B64}:(?:${B64})?$`);
const V1 = new RegExp(`^v1:${B64}:${B64}:(?:${B64})?$`);

export function isEncryptedText(value: string): boolean {
  return V2.test(value) || V1.test(value);
}

export function encryptText(plain: string, context: string): string {
  const key = currentKey();
  const { iv, tag, data } = seal(key, Buffer.from(plain, "utf8"), context);
  return ["v2", key.id, iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(":");
}

export function decryptText(stored: string, context: string): string {
  const parts = stored.split(":");
  if (parts[0] === "v2" && parts.length === 5) {
    const [, id, iv, tag, data] = parts;
    return open(keyById(id), Buffer.from(iv, "base64"), Buffer.from(tag, "base64"), Buffer.from(data, "base64"), context).toString("utf8");
  }
  if (parts[0] === "v1" && parts.length === 4) {
    // Before key ids: try each configured key; GCM refuses the wrong ones.
    const [, iv, tag, data] = parts;
    for (const key of ring().all) {
      try {
        return open(key, Buffer.from(iv, "base64"), Buffer.from(tag, "base64"), Buffer.from(data, "base64"), null).toString("utf8");
      } catch {
        // next key
      }
    }
    throw new Error("No configured key decrypts this value.");
  }
  throw new Error("Unrecognised encrypted value.");
}

/** Key id of a stored text value: "v1" for the legacy format. */
export function textKeyId(stored: string): string | null {
  const parts = stored.split(":");
  if (parts[0] === "v2" && parts.length === 5) return parts[1];
  if (parts[0] === "v1") return "v1";
  return null;
}

// --- bytes ------------------------------------------------------------------

export function isEncryptedBytes(value: Uint8Array): boolean {
  return value.length >= 36 && Buffer.from(value.subarray(0, 4)).equals(MAGIC);
}

export function encryptBytes(plain: Uint8Array, context: string): Buffer {
  const key = currentKey();
  const { iv, tag, data } = seal(key, Buffer.from(plain), context);
  return Buffer.concat([MAGIC, Buffer.from(key.id, "hex"), iv, tag, data]);
}

export function decryptBytes(stored: Uint8Array, context: string): Buffer {
  const buf = Buffer.from(stored);
  if (!isEncryptedBytes(buf)) throw new Error("Unrecognised encrypted bytes.");
  const id = buf.subarray(4, 8).toString("hex");
  return open(keyById(id), buf.subarray(8, 20), buf.subarray(20, 36), buf.subarray(36), context);
}

export function bytesKeyId(stored: Uint8Array): string | null {
  return isEncryptedBytes(stored) ? Buffer.from(stored.subarray(4, 8)).toString("hex") : null;
}

// --- third-party secrets (WhatsApp tokens) ------------------------------------

const SECRET_CONTEXT = "whatsapp_config.access_token_encrypted";

export function encryptSecret(plain: string): string {
  if (!isEncryptionConfigured()) throw new AppError("Secrets cannot be stored: DATA_ENCRYPTION_KEY is not set on the server.");
  return encryptText(plain, SECRET_CONTEXT);
}

export function decryptSecret(stored: string): string {
  return decryptText(stored, SECRET_CONTEXT);
}
