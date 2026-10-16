// Auth.js instance for the operations console (Super Admin / operators).
// Own cookie, own secret, own base path. Sessions last one hour from sign-in
// and are never extended.
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { verifyOperatorLogin } from "@/features/platform/operator-login.service";
import { requestMetaFrom } from "@/lib/request";
import { isValidSessionProof } from "./session-proof";

const secure = (process.env.AUTH_URL ?? "").startsWith("https://");
const prefix = secure ? "__Secure-" : "";

export const PLATFORM_SESSION_COOKIE = `${prefix}medflow.platform`;
export const PLATFORM_SESSION_SECONDS = 60 * 60;

class RateLimited extends CredentialsSignin {
  code = "rate_limited";
}
class AccountDisabled extends CredentialsSignin {
  code = "account_disabled";
}

const credentialsSchema = z.object({
  email: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(200),
});

export const {
  handlers: platformHandlers,
  auth: platformAuth,
  signIn: platformSignIn,
  signOut: platformSignOut,
  unstable_update: updatePlatformSession,
} = NextAuth({
  basePath: "/api/platform/auth",
  secret: process.env.PLATFORM_AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt", maxAge: PLATFORM_SESSION_SECONDS },
  // Auth.js treats any cookie whose name starts with the session cookie name as
  // a chunk of the session token, so helper cookies must not share that prefix.
  cookies: {
    sessionToken: {
      name: PLATFORM_SESSION_COOKIE,
      options: { httpOnly: true, sameSite: "strict", path: "/", secure },
    },
    callbackUrl: {
      name: `${prefix}medflow_platform_callback`,
      options: { httpOnly: true, sameSite: "strict", path: "/", secure },
    },
    csrfToken: {
      name: `${secure ? "__Host-" : ""}medflow_platform_csrf`,
      options: { httpOnly: true, sameSite: "strict", path: "/", secure },
    },
  },
  providers: [
    Credentials({
      id: "operator",
      credentials: { email: {}, password: {} },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const result = await verifyOperatorLogin({ ...parsed.data, meta: requestMetaFrom(request) });
        if (!result.ok) {
          if (result.reason === "rate_limited") throw new RateLimited();
          if (result.reason === "account_disabled") throw new AccountDisabled();
          return null;
        }

        return {
          id: result.operator.id,
          email: result.operator.email,
          name: result.operator.name,
          sessionVersion: result.operator.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.oid = user.id;
        token.sv = user.sessionVersion;
        token.loginAt = Date.now();
      }
      // Only a server-minted proof can move the session version (see session-proof.ts).
      if (trigger === "update" && isValidSessionProof(process.env.PLATFORM_AUTH_SECRET, token.oid, session?.sv, session?.proof)) {
        token.sv = session.sv;
      }
      // Hard one-hour limit from sign-in, regardless of activity.
      if (typeof token.loginAt !== "number" || Date.now() - token.loginAt > PLATFORM_SESSION_SECONDS * 1000) {
        return null;
      }
      return token;
    },
    session({ session, token }) {
      return { ...session, oid: token.oid, sv: token.sv, loginAt: token.loginAt };
    },
  },
  pages: { signIn: "/platform/login" },
});
