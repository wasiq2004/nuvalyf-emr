import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { withAppConnection, withClinic } from "@/lib/db";
import { clinics, users } from "@/lib/db/schema";
import { recordAudit } from "@/lib/audit";
import { burnPasswordCheck, verifyPassword } from "@/lib/auth/passwords";
import { rateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request";

export type ClinicLoginResult =
  | { ok: true; user: { id: string; clinicId: string; sessionVersion: number; email: string; name: string } }
  | { ok: false; reason: "invalid" | "rate_limited" | "clinic_suspended" | "account_disabled" };

const WINDOW = 15 * 60 * 1000;

export async function verifyClinicLogin(input: {
  clinicCode: string;
  email: string;
  password: string;
  meta: RequestMeta;
}): Promise<ClinicLoginResult> {
  const clinicCode = input.clinicCode.trim().toLowerCase();
  const email = input.email.trim().toLowerCase();

  const limited = await withAppConnection(async (db) => {
    const byAccount = await rateLimit(db, `login:clinic:${clinicCode}:${email}`, { limit: 10, windowMs: WINDOW });
    const byIp = await rateLimit(db, `login:ip:${input.meta.ipAddress ?? "unknown"}`, { limit: 50, windowMs: WINDOW });
    return !byAccount.allowed || !byIp.allowed;
  });
  if (limited) return { ok: false, reason: "rate_limited" };

  const [clinic] = await withAppConnection((db) =>
    db
      .select({ id: clinics.id, status: clinics.status })
      .from(clinics)
      .where(eq(clinics.code, clinicCode))
      .limit(1),
  );

  if (!clinic) {
    await burnPasswordCheck(input.password);
    return { ok: false, reason: "invalid" };
  }

  return withClinic({ clinicId: clinic.id }, async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(and(eq(users.clinicId, clinic.id), sql`lower(${users.email}) = ${email}`))
      .limit(1);

    const valid = user ? await verifyPassword(user.passwordHash, input.password) : false;
    if (!user) await burnPasswordCheck(input.password);

    if (!user || !valid) {
      await recordAudit(tx, {
        clinicId: clinic.id,
        actorUserId: user?.id ?? null,
        action: "LOGIN_FAILED",
        targetType: "user",
        targetId: user?.id ?? null,
        outcome: "denied",
        severity: "warning",
        details: { email },
        meta: input.meta,
      });
      return { ok: false, reason: "invalid" } as const;
    }

    // Only reveal suspension/deactivation to someone who knows the password.
    const refusal =
      clinic.status !== "active" ? "clinic_suspended" : user.status !== "active" ? "account_disabled" : null;
    if (refusal) {
      await recordAudit(tx, {
        clinicId: clinic.id,
        actorUserId: user.id,
        action: "LOGIN_REFUSED",
        targetType: "user",
        targetId: user.id,
        outcome: "denied",
        severity: "warning",
        details: { reason: refusal },
        meta: input.meta,
      });
      return { ok: false, reason: refusal } as const;
    }

    await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await recordAudit(tx, {
      clinicId: clinic.id,
      actorUserId: user.id,
      action: "LOGIN",
      targetType: "user",
      targetId: user.id,
      meta: input.meta,
    });

    return {
      ok: true,
      user: {
        id: user.id,
        clinicId: clinic.id,
        sessionVersion: user.sessionVersion,
        email: user.email,
        name: `${user.firstName} ${user.lastName}`.trim(),
      },
    } as const;
  });
}
