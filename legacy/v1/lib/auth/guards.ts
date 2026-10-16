import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError } from "@/lib/errors";
import type { UserRole } from "@/types";

export type SessionUser = {
  id: string;
  role: UserRole;
  email: string;
  name?: string | null;
};

export const ROLE_HOME: Record<UserRole, string> = {
  admin: "/admin",
  doctor: "/doctor",
  patient: "/patient",
};

/**
 * For server actions: returns the signed-in user or throws.
 * Every action must call this - the proxy deliberately lets Server Action
 * requests through, so this is the only thing protecting them.
 */
export async function requireUser(roles?: UserRole[]): Promise<SessionUser> {
  const session = await auth();
  const user = session?.user;

  if (!user?.id || !user.role) {
    throw new AuthorizationError("Your session has expired. Please sign in again.");
  }
  if (roles && !roles.includes(user.role)) {
    throw new AuthorizationError();
  }

  return { id: user.id, role: user.role, email: user.email, name: user.name };
}

/** For pages and layouts: redirects instead of throwing. */
export async function requirePageRole(role: UserRole): Promise<SessionUser> {
  const session = await auth();
  const user = session?.user;

  if (!user?.id || !user.role) redirect("/login");
  if (user.role !== role) redirect(ROLE_HOME[user.role] ?? "/login");

  return { id: user.id, role: user.role, email: user.email, name: user.name };
}
