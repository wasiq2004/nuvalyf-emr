import "server-only";

// Auth.js lets the browser post arbitrary data into the jwt "update" trigger
// (POST /api/auth/session). A new session version is therefore only accepted
// with a proof the server minted: an HMAC of subject + version under the
// panel's own secret. A stolen cookie cannot forge one to revive itself after
// a password change or a revocation.
import { createHmac, timingSafeEqual } from "crypto";

export function sessionProof(secret: string | undefined, subject: string, version: number): string {
  if (!secret) throw new Error("Auth secret is not configured");
  return createHmac("sha256", secret).update(`session-version:${subject}:${version}`).digest("base64url");
}

export function isValidSessionProof(secret: string | undefined, subject: unknown, version: unknown, proof: unknown): boolean {
  if (!secret || typeof subject !== "string" || typeof version !== "number" || typeof proof !== "string") return false;
  const expected = Buffer.from(sessionProof(secret, subject, version));
  const given = Buffer.from(proof);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
