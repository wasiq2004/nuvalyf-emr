import "server-only";

import bcrypt from "bcrypt";
import { db, type TxDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { and, isNull, sql } from "drizzle-orm";
import type { UserRole } from "@/types";

const BCRYPT_ROUNDS = 12;

// Hash of a random string, compared against when the user does not exist so
// that response time does not reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync("medflow-timing-equalizer", BCRYPT_ROUNDS);

export async function getUserByEmail(email: string) {
  const result = await db
    .select()
    .from(users)
    .where(and(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`, isNull(users.deletedAt)))
    .limit(1);

  return result[0] ?? null;
}

export async function createUser(
  input: {
    email: string;
    password: string;
    role: UserRole;
    firstName: string;
    lastName: string;
  },
  txDb: TxDb = db,
) {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const result = await txDb
    .insert(users)
    .values({
      email: input.email.trim().toLowerCase(),
      passwordHash,
      role: input.role,
      firstName: input.firstName,
      lastName: input.lastName,
    })
    .returning({
      id: users.id,
      email: users.email,
      role: users.role,
    });

  return result[0];
}

/**
 * Verifies credentials in roughly constant time. Returns the user on success.
 */
export async function verifyCredentials(email: string, password: string) {
  const user = await getUserByEmail(email);
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  return user && valid ? user : null;
}

export function displayName(firstName?: string | null, lastName?: string | null): string {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}
