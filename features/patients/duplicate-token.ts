// Proof that a duplicate search ran before a registration (Receptionist flow:
// "the form will not submit without the token it returns").
//
// The token binds: clinic, user, the exact identifying details searched, the
// likely duplicates found, and an expiry. It is HMAC-signed with a key derived
// from AUTH_SECRET, so it cannot be forged or reused for different details.
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { normalizeMobile, normalizeName } from "./patient-rules";

export const DUPLICATE_TOKEN_TTL_MS = 20 * 60 * 1000;

export type IdentityFields = {
  firstName: string;
  lastName?: string | null;
  mobile?: string | null;
  dateOfBirth?: string | null;
  statedAgeYears?: number | null;
};

type Payload = {
  c: string; // clinic
  u: string; // user
  f: string; // fingerprint of the searched details
  l: string[]; // likely duplicate ids
  e: number; // expiry (ms)
};

export function fingerprint(fields: IdentityFields): string {
  const parts = [
    normalizeName(fields.firstName),
    normalizeName(fields.lastName),
    normalizeMobile(fields.mobile) ?? "",
    fields.dateOfBirth ?? "",
    fields.statedAgeYears ?? "",
  ];
  return createHash("sha256").update(parts.join("|")).digest("base64url");
}

function key(secret: string): Buffer {
  return createHash("sha256").update(`medflow-duplicate-token:${secret}`).digest();
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", key(secret)).update(body).digest("base64url");
}

export function issueDuplicateToken(
  input: { clinicId: string; userId: string; fields: IdentityFields; likelyIds: string[]; now?: number },
  secret: string,
): string {
  const payload: Payload = {
    c: input.clinicId,
    u: input.userId,
    f: fingerprint(input.fields),
    l: input.likelyIds,
    e: (input.now ?? Date.now()) + DUPLICATE_TOKEN_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export type TokenCheck =
  | { ok: true; likelyIds: string[] }
  | { ok: false; reason: "missing" | "invalid" | "expired" | "mismatch" };

export function verifyDuplicateToken(
  token: string | null | undefined,
  expected: { clinicId: string; userId: string; fields: IdentityFields; now?: number },
  secret: string,
): TokenCheck {
  if (!token) return { ok: false, reason: "missing" };
  const [body, signature] = token.split(".");
  if (!body || !signature) return { ok: false, reason: "invalid" };

  const expectedSig = Buffer.from(sign(body, secret));
  const actualSig = Buffer.from(signature);
  if (expectedSig.length !== actualSig.length || !timingSafeEqual(expectedSig, actualSig)) {
    return { ok: false, reason: "invalid" };
  }

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (payload.c !== expected.clinicId || payload.u !== expected.userId) return { ok: false, reason: "invalid" };
  if ((expected.now ?? Date.now()) > payload.e) return { ok: false, reason: "expired" };
  if (payload.f !== fingerprint(expected.fields)) return { ok: false, reason: "mismatch" };
  return { ok: true, likelyIds: payload.l };
}
