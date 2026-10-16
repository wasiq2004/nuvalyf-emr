import "server-only";

import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { Queryable } from "@/lib/db";
import { operators } from "@/lib/db/schema";
import { AppError, isUniqueViolation } from "@/lib/errors";
import { generateOneTimePassword, hashPassword, verifyPassword } from "@/lib/auth/passwords";

export async function listOperators(db: Queryable) {
  return db
    .select({
      id: operators.id,
      email: operators.email,
      name: operators.name,
      role: operators.role,
      status: operators.status,
      lastLoginAt: operators.lastLoginAt,
      createdAt: operators.createdAt,
    })
    .from(operators)
    .orderBy(asc(operators.name));
}

export async function createOperator(
  db: Queryable,
  input: { email: string; name: string; role: "platform_admin" | "operator"; createdBy: string },
): Promise<{ id: string; oneTimePassword: string }> {
  const oneTimePassword = generateOneTimePassword();
  try {
    const [row] = await db
      .insert(operators)
      .values({
        email: input.email,
        name: input.name,
        role: input.role,
        passwordHash: await hashPassword(oneTimePassword),
        mustChangePassword: true,
        createdBy: input.createdBy,
      })
      .returning({ id: operators.id });
    return { id: row.id, oneTimePassword };
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("An operator with this email already exists.");
    throw error;
  }
}

async function activePlatformAdminsExcept(db: Queryable, operatorId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(operators)
    .where(and(eq(operators.role, "platform_admin"), eq(operators.status, "active"), ne(operators.id, operatorId)));
  return Number(row?.n ?? 0);
}

export async function updateOperator(
  db: Queryable,
  input: { id: string; role: "platform_admin" | "operator"; status: "active" | "disabled"; actorId: string },
) {
  if (input.id === input.actorId && (input.status !== "active" || input.role !== "platform_admin")) {
    throw new AppError("You cannot disable or demote your own account.");
  }
  const [current] = await db.select().from(operators).where(eq(operators.id, input.id));
  if (!current) throw new AppError("Operator not found.");

  const losesAdmin =
    current.role === "platform_admin" && current.status === "active" && (input.role !== "platform_admin" || input.status !== "active");
  if (losesAdmin && (await activePlatformAdminsExcept(db, input.id)) === 0) {
    throw new AppError("The platform must keep at least one active Platform Admin.");
  }

  await db
    .update(operators)
    .set({
      role: input.role,
      status: input.status,
      // Disabling or changing role ends existing sessions.
      sessionVersion: sql`${operators.sessionVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(operators.id, input.id));
}

export async function resetOperatorPassword(db: Queryable, id: string): Promise<{ oneTimePassword: string; email: string }> {
  const oneTimePassword = generateOneTimePassword();
  const [row] = await db
    .update(operators)
    .set({
      passwordHash: await hashPassword(oneTimePassword),
      mustChangePassword: true,
      sessionVersion: sql`${operators.sessionVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(operators.id, id))
    .returning({ email: operators.email });
  if (!row) throw new AppError("Operator not found.");
  return { oneTimePassword, email: row.email };
}

/** Returns the new session version so the caller can refresh its own session. */
export async function changeOperatorPassword(
  db: Queryable,
  input: { id: string; currentPassword: string; newPassword: string },
): Promise<number> {
  const [operator] = await db.select().from(operators).where(eq(operators.id, input.id));
  if (!operator) throw new AppError("Account not found.");
  if (!(await verifyPassword(operator.passwordHash, input.currentPassword))) {
    throw new AppError("Your current password is incorrect.");
  }
  if (input.currentPassword === input.newPassword) {
    throw new AppError("Choose a password different from the current one.");
  }

  const [row] = await db
    .update(operators)
    .set({
      passwordHash: await hashPassword(input.newPassword),
      mustChangePassword: false,
      sessionVersion: sql`${operators.sessionVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(operators.id, input.id))
    .returning({ sv: operators.sessionVersion });
  return row.sv;
}
