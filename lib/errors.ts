import { fail, type ActionResult } from "@/lib/action-result";

/**
 * An error whose message is safe to show to the end user. Anything else that
 * escapes a server action is logged and replaced with a generic message.
 */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppError";
  }
}

/** Converts a thrown error into an action failure without leaking internals. */
export function errorToResult(error: unknown, fallback = "Something went wrong. Please try again."): ActionResult<never> {
  if (error instanceof AppError) return fail(error.message);
  if (isLockedRecord(error)) return fail("This record is finalised and can no longer be changed.");
  console.error("[action] unexpected error:", describeError(error));
  return fail(fallback);
}

type PgError = { code?: string; constraint_name?: string; constraint?: string };

/** The Postgres error behind a driver/ORM error, if any. */
export function pgError(error: unknown): PgError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const candidate = current as PgError & { cause?: unknown };
    if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return candidate;
    }
    current = candidate.cause;
  }
  return null;
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pg = pgError(error);
  if (pg?.code !== "23505") return false;
  if (!constraint) return true;
  return (pg.constraint_name ?? pg.constraint) === constraint;
}

/**
 * Two transactions collided on the same constrained resource: an exclusion
 * violation, or the deadlock Postgres raises when both insert conflicting rows
 * at once (it aborts one; the other wins).
 */
export function isConcurrentConflict(error: unknown): boolean {
  const code = pgError(error)?.code;
  return code === "23P01" || code === "40P01" || code === "40001";
}

export function isForeignKeyViolation(error: unknown): boolean {
  return pgError(error)?.code === "23503";
}

/**
 * A database guard refused the change: a finalised consultation, a signed
 * prescription or a closed lab order (SQLSTATE MFL01, db/sql/security.sql).
 */
export function isLockedRecord(error: unknown): boolean {
  return pgError(error)?.code === "MFL01";
}

/**
 * A log-safe description of an error. Database errors carry the query's
 * parameters (password hashes, patient details, note text); only the error
 * type, SQLSTATE, constraint and the statement text without values are kept.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error).slice(0, 300);
  const pg = pgError(error);
  const message = error.message.split(/\n\s*params:/i)[0].slice(0, 500);
  const parts = [`${error.name}: ${message}`];
  if (pg?.code) parts.push(`sqlstate=${pg.code}`);
  const constraint = pg?.constraint_name ?? pg?.constraint;
  if (constraint) parts.push(`constraint=${constraint}`);
  return parts.join(" ");
}
