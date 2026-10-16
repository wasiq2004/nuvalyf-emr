import "server-only";

import { eq, sql } from "drizzle-orm";
import { withPlatform } from "@/lib/db";
import { operators } from "@/lib/db/schema";
import { recordPlatformAudit } from "@/lib/audit";
import { burnPasswordCheck, verifyPassword } from "@/lib/auth/passwords";
import { rateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request";

export type OperatorLoginResult =
  | { ok: true; operator: { id: string; sessionVersion: number; email: string; name: string } }
  | { ok: false; reason: "invalid" | "rate_limited" | "account_disabled" };

const WINDOW = 15 * 60 * 1000;

export async function verifyOperatorLogin(input: {
  email: string;
  password: string;
  meta: RequestMeta;
}): Promise<OperatorLoginResult> {
  const email = input.email.trim().toLowerCase();

  return withPlatform(async (db) => {
    const byAccount = await rateLimit(db, `platform-login:${email}`, { limit: 5, windowMs: WINDOW });
    const byIp = await rateLimit(db, `platform-login-ip:${input.meta.ipAddress ?? "unknown"}`, { limit: 20, windowMs: WINDOW });
    if (!byAccount.allowed || !byIp.allowed) return { ok: false, reason: "rate_limited" } as const;

    const [operator] = await db
      .select()
      .from(operators)
      .where(sql`lower(${operators.email}) = ${email}`)
      .limit(1);

    const valid = operator ? await verifyPassword(operator.passwordHash, input.password) : false;
    if (!operator) await burnPasswordCheck(input.password);

    if (!operator || !valid) {
      await recordPlatformAudit(db, {
        operatorId: operator?.id ?? null,
        action: "OPERATOR_LOGIN_FAILED",
        outcome: "denied",
        details: { email },
        meta: input.meta,
      });
      return { ok: false, reason: "invalid" } as const;
    }

    if (operator.status !== "active") {
      await recordPlatformAudit(db, {
        operatorId: operator.id,
        action: "OPERATOR_LOGIN_REFUSED",
        outcome: "denied",
        details: { reason: "disabled" },
        meta: input.meta,
      });
      return { ok: false, reason: "account_disabled" } as const;
    }

    await db.update(operators).set({ lastLoginAt: new Date() }).where(eq(operators.id, operator.id));
    await recordPlatformAudit(db, { operatorId: operator.id, action: "OPERATOR_LOGIN", meta: input.meta });

    return {
      ok: true,
      operator: {
        id: operator.id,
        sessionVersion: operator.sessionVersion,
        email: operator.email,
        name: operator.name,
      },
    } as const;
  });
}
