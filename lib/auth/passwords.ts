import "server-only";

import { randomInt } from "crypto";
import { hash, verify } from "@node-rs/argon2";

export const STAFF_PASSWORD_MIN = 10;
export const OPERATOR_PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** argon2id with the library's recommended defaults. */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifies against a throwaway hash so a login for an unknown account takes
 * as long as one for a real account (no account enumeration by timing).
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hash("medflow-timing-equalizer");
  await verifyPassword(await dummyHash, password);
}

// No 0/O, 1/l/I to avoid misreading a password someone copies by hand.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** e.g. "K7mP-x9Qa-3Rtw": shown once, never stored in plain text. */
export function generateOneTimePassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < 3; g++) {
    let group = "";
    for (let i = 0; i < 4; i++) group += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(group);
  }
  return groups.join("-");
}
