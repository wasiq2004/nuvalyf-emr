// Application-level encryption and the keyring: what an auditor will ask.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCipheriv, randomBytes } from "crypto";
import { assertKeyring, keyId, loadKeyring } from "@/lib/keyring";
import { bytesKeyId, decryptBytes, decryptSecret, decryptText, encryptBytes, encryptSecret, encryptText, isEncryptedBytes, isEncryptedText, textKeyId } from "@/lib/crypto";

const A = randomBytes(32).toString("base64");
const B = randomBytes(32).toString("base64");
const saved = { ...process.env };

beforeEach(() => {
  process.env.DATA_ENCRYPTION_KEY = A;
  delete process.env.DATA_ENCRYPTION_KEYS_OLD;
});
afterEach(() => {
  process.env.DATA_ENCRYPTION_KEY = saved.DATA_ENCRYPTION_KEY;
  process.env.DATA_ENCRYPTION_KEYS_OLD = saved.DATA_ENCRYPTION_KEYS_OLD;
});

describe("keyring", () => {
  it("stops a production server with no key", () => {
    expect(() => assertKeyring({ NODE_ENV: "production" })).toThrow(/DATA_ENCRYPTION_KEY is not set/);
    expect(assertKeyring({ NODE_ENV: "production", DATA_ENCRYPTION_KEY: A }).current?.id).toBe(keyId(Buffer.from(A, "base64")));
  });

  it("refuses a key that is not 32 bytes of base64", () => {
    expect(() => loadKeyring({ DATA_ENCRYPTION_KEY: "short" })).toThrow(/32 random bytes/);
    expect(() => loadKeyring({ DATA_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/32 random bytes/);
  });

  it("refuses an old key that is the current one", () => {
    expect(() => loadKeyring({ DATA_ENCRYPTION_KEY: A, DATA_ENCRYPTION_KEYS_OLD: A })).toThrow(/repeats a key/);
  });
});

describe("text", () => {
  it("round-trips, and is unreadable stored", () => {
    const stored = encryptText("Severe chest pain since morning", "encounters.notes");
    expect(stored).toMatch(/^v2:[0-9a-f]{8}:/);
    expect(stored).not.toContain("chest");
    expect(decryptText(stored, "encounters.notes")).toBe("Severe chest pain since morning");
  });

  it("does not mistake an old plain note that begins with v2: for ciphertext", () => {
    expect(isEncryptedText("v2: review in two weeks")).toBe(false);
    expect(isEncryptedText("v1:")).toBe(false);
    expect(isEncryptedText(encryptText("", "c"))).toBe(true);
    expect(isEncryptedText(encryptText("note", "c"))).toBe(true);
  });

  it("gives a different ciphertext every time, so equal notes cannot be spotted", () => {
    expect(encryptText("same", "c")).not.toBe(encryptText("same", "c"));
  });

  it("will not decrypt a value moved into another column", () => {
    const stored = encryptText("secret", "encounters.notes");
    expect(() => decryptText(stored, "private_notes.body")).toThrow();
  });

  it("detects a single changed character", () => {
    const stored = encryptText("Hb 6.2 g/dL", "c");
    const parts = stored.split(":");
    const data = Buffer.from(parts[4], "base64");
    data[0] ^= 1;
    parts[4] = data.toString("base64");
    expect(() => decryptText(parts.join(":"), "c")).toThrow();
  });

  it("still reads a value under the old key after rotation, and writes with the new one", () => {
    const old = encryptText("written last year", "c");
    process.env.DATA_ENCRYPTION_KEY = B;
    process.env.DATA_ENCRYPTION_KEYS_OLD = A;
    expect(decryptText(old, "c")).toBe("written last year");
    expect(textKeyId(encryptText("new", "c"))).toBe(keyId(Buffer.from(B, "base64")));
  });

  it("names the missing key once the old key is removed", () => {
    const old = encryptText("x", "c");
    process.env.DATA_ENCRYPTION_KEY = B;
    expect(() => decryptText(old, "c")).toThrow(/not configured/);
  });

  it("reads the format from before key rotation (v1)", () => {
    const key = Buffer.from(A, "base64");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update("legacy token", "utf8"), cipher.final()]);
    const v1 = ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
    expect(decryptSecret(v1)).toBe("legacy token");
    expect(textKeyId(v1)).toBe("v1");
  });

  it("will not save a secret without a key", () => {
    delete process.env.DATA_ENCRYPTION_KEY;
    expect(() => encryptSecret("token")).toThrow(/DATA_ENCRYPTION_KEY is not set/);
  });
});

describe("bytes (documents)", () => {
  it("round-trips a PDF, with no readable header left", () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(5000)]);
    const stored = encryptBytes(pdf, "lab_document_files.content");
    expect(isEncryptedBytes(stored)).toBe(true);
    expect(stored.includes(Buffer.from("%PDF"))).toBe(false);
    expect(bytesKeyId(stored)).toBe(keyId(Buffer.from(A, "base64")));
    expect(decryptBytes(stored, "lab_document_files.content").equals(pdf)).toBe(true);
  });

  it("refuses a changed byte and another context", () => {
    const stored = encryptBytes(Buffer.from("scan"), "lab_document_files.content");
    const changed = Buffer.from(stored);
    changed[changed.length - 1] ^= 1;
    expect(() => decryptBytes(changed, "lab_document_files.content")).toThrow();
    expect(() => decryptBytes(stored, "other")).toThrow();
  });
});
