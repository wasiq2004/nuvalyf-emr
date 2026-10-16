import "server-only";

// Encryption at rest for third-party secrets (e.g. a clinic's WhatsApp access
// token). AES-256-GCM with a key from DATA_ENCRYPTION_KEY (32 bytes, base64).
// Without the key, secrets cannot be saved - never stored in plain text.
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { AppError } from "@/lib/errors";

function key(): Buffer | null {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) return null;
  const buf = Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}

export function isEncryptionConfigured(): boolean {
  return key() !== null;
}

export function encryptSecret(plain: string): string {
  const k = key();
  if (!k) throw new AppError("Secrets cannot be stored: DATA_ENCRYPTION_KEY is not set on the server.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const k = key();
  if (!k) throw new Error("DATA_ENCRYPTION_KEY is not set");
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised secret format");
  const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
