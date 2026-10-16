import "server-only";

import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { hashPassword, verifyPassword } from "@/lib/auth/passwords";

/**
 * Changes a staff member's own password. Ends their other sessions and returns
 * the new session version so the current session can continue.
 */
export async function changeOwnPassword(
  tx: Tx,
  input: { userId: string; currentPassword: string; newPassword: string },
): Promise<number> {
  const [user] = await tx.select().from(users).where(eq(users.id, input.userId)).limit(1);
  if (!user) throw new AppError("Account not found.");
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw new AppError("Your current password is incorrect.");
  }
  if (input.currentPassword === input.newPassword) {
    throw new AppError("Choose a password different from the current one.");
  }
  if (input.newPassword.toLowerCase().includes(user.email.split("@")[0].toLowerCase())) {
    throw new AppError("Don't use your email name in your password.");
  }

  const [row] = await tx
    .update(users)
    .set({
      passwordHash: await hashPassword(input.newPassword),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      sessionVersion: sql`${users.sessionVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, input.userId))
    .returning({ sv: users.sessionVersion });

  return row.sv;
}
