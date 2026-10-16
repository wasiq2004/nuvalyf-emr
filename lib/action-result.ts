// The shape every server action returns. Shared by server and client code.
import type { ZodError } from "zod";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function ok<T = undefined>(data?: T): ActionResult<T> {
  return { ok: true, data: data as T };
}

export function fail(error: string, fieldErrors?: Record<string, string>): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

/** First error per field, keyed by the top-level field name. */
export function fromZodError(error: ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  const first = error.issues[0]?.message ?? "Please check the form and try again.";
  return fail(Object.keys(fieldErrors).length > 1 ? "Please fix the highlighted fields." : first, fieldErrors);
}

/**
 * Turns FormData into a plain object. Repeated keys (checkbox groups,
 * multi-selects) become arrays; empty strings become undefined so optional
 * fields validate cleanly.
 */
export function formDataToObject(formData: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of new Set(formData.keys())) {
    if (key.startsWith("$ACTION")) continue;
    const values = formData.getAll(key).map((v) => (typeof v === "string" ? v : v));
    const cleaned = values.map((v) => (v === "" ? undefined : v));
    result[key] = key.endsWith("[]") ? cleaned.filter((v) => v !== undefined) : cleaned[0];
  }
  // "roles[]" -> "roles"
  for (const key of Object.keys(result)) {
    if (key.endsWith("[]")) {
      result[key.slice(0, -2)] = result[key];
      delete result[key];
    }
  }
  return result;
}
