import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";
import { forbidden, redirect } from "next/navigation";
import { platformAuth } from "@/lib/auth/platform-auth";
import { withPlatform } from "@/lib/db";
import { operators } from "@/lib/db/schema";

export type OperatorRole = "platform_admin" | "operator";

export type OperatorContext = {
  id: string;
  email: string;
  name: string;
  role: OperatorRole;
  mustChangePassword: boolean;
};

type OperatorSessionState = { status: "ok"; ctx: OperatorContext } | { status: "signed_out" | "disabled" | "expired" };

export const getOperatorSession = cache(async (): Promise<OperatorSessionState> => {
  const session = await platformAuth();
  if (!session?.oid || typeof session.sv !== "number") return { status: "signed_out" };

  const [operator] = await withPlatform((db) =>
    db.select().from(operators).where(eq(operators.id, session.oid!)).limit(1),
  );
  if (!operator) return { status: "signed_out" };
  if (operator.status !== "active") return { status: "disabled" };
  if (operator.sessionVersion !== session.sv) return { status: "expired" };

  return {
    status: "ok",
    ctx: {
      id: operator.id,
      email: operator.email,
      name: operator.name,
      role: operator.role as OperatorRole,
      mustChangePassword: operator.mustChangePassword,
    },
  };
});

/** Page guard for the operations console. */
export async function requireOperator(
  options: { role?: OperatorRole; allowPendingPasswordChange?: boolean } = {},
): Promise<OperatorContext> {
  const state = await getOperatorSession();
  if (state.status !== "ok") {
    redirect(state.status === "signed_out" ? "/platform/login" : `/platform/login?reason=${state.status}`);
  }
  const { ctx } = state;
  if (ctx.mustChangePassword && !options.allowPendingPasswordChange) {
    redirect("/platform/account/password");
  }
  if (options.role === "platform_admin" && ctx.role !== "platform_admin") {
    forbidden();
  }
  return ctx;
}
