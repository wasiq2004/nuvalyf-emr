import "server-only";

// Idempotent multi-step operations (a sale, a dispensing, a stock receipt).
//
// The first request with a key inserts it, does the work and stores the
// result in the same transaction. A concurrent duplicate blocks on the key's
// row until the first commits, then reads its result; a later retry reads it
// straight away. If the first transaction rolls back, the key goes with it and
// the retry does the work. The same key with different input is refused.
import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { idempotencyKeys } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stable(v)]),
    );
  }
  return value;
}

export function fingerprint(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(input))).digest("hex");
}

export async function idempotent<T>(
  tx: Tx,
  scope: { clinicId: string; name: string; key: string; input: unknown },
  work: () => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  const print = fingerprint(scope.input);
  const claimed = await tx
    .insert(idempotencyKeys)
    .values({ clinicId: scope.clinicId, scope: scope.name, key: scope.key, fingerprint: print })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });

  const where = and(eq(idempotencyKeys.clinicId, scope.clinicId), eq(idempotencyKeys.scope, scope.name), eq(idempotencyKeys.key, scope.key));
  if (claimed.length === 0) {
    const [previous] = await tx.select().from(idempotencyKeys).where(where).limit(1);
    if (!previous || previous.fingerprint !== print) {
      throw new AppError("This form was already used for something different. Reload the page and try again.");
    }
    return { result: previous.result as T, replayed: true };
  }

  const result = await work();
  await tx.update(idempotencyKeys).set({ result: result as object }).where(where);
  return { result, replayed: false };
}
