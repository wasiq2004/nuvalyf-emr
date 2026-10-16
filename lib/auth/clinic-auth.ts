// Auth.js instance for clinic staff (clinic + compliance panels).
// Separate from the operations console: different cookie, secret and lifetime,
// so neither session can be used on the other side.
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { verifyClinicLogin } from "@/features/auth/clinic-login.service";
import { requestMetaFrom } from "@/lib/request";
import { isValidSessionProof } from "./session-proof";

const secure = (process.env.AUTH_URL ?? "").startsWith("https://");
const prefix = secure ? "__Secure-" : "";

export const CLINIC_SESSION_COOKIE = `${prefix}medflow.clinic`;
export const CLINIC_SESSION_MAX_AGE = 8 * 60 * 60;

class RateLimited extends CredentialsSignin {
  code = "rate_limited";
}
class ClinicSuspended extends CredentialsSignin {
  code = "clinic_suspended";
}
class AccountDisabled extends CredentialsSignin {
  code = "account_disabled";
}

const credentialsSchema = z.object({
  clinicCode: z.string().trim().min(1).max(40),
  email: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(200),
});

export const {
  handlers: clinicHandlers,
  auth: clinicAuth,
  signIn: clinicSignIn,
  signOut: clinicSignOut,
  unstable_update: updateClinicSession,
} = NextAuth({
  basePath: "/api/auth",
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt", maxAge: CLINIC_SESSION_MAX_AGE },
  // Auth.js treats any cookie whose name starts with the session cookie name as
  // a chunk of the session token, so helper cookies must not share that prefix.
  cookies: {
    sessionToken: {
      name: CLINIC_SESSION_COOKIE,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure },
    },
    callbackUrl: {
      name: `${prefix}medflow_clinic_callback`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure },
    },
    csrfToken: {
      name: `${secure ? "__Host-" : ""}medflow_clinic_csrf`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure },
    },
  },
  providers: [
    Credentials({
      id: "clinic",
      credentials: { clinicCode: {}, email: {}, password: {} },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const result = await verifyClinicLogin({ ...parsed.data, meta: requestMetaFrom(request) });
        if (!result.ok) {
          if (result.reason === "rate_limited") throw new RateLimited();
          if (result.reason === "clinic_suspended") throw new ClinicSuspended();
          if (result.reason === "account_disabled") throw new AccountDisabled();
          return null;
        }

        return {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          clinicId: result.user.clinicId,
          sessionVersion: result.user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.uid = user.id;
        token.cid = user.clinicId;
        token.sv = user.sessionVersion;
        token.loginAt = Date.now();
      }
      // Only a server-minted proof can move the session version (see session-proof.ts).
      if (trigger === "update" && isValidSessionProof(process.env.AUTH_SECRET, token.uid, session?.sv, session?.proof)) {
        token.sv = session.sv;
      }
      // Absolute limit from sign-in: refreshing the token never extends a session.
      if (typeof token.loginAt !== "number" || Date.now() - token.loginAt > CLINIC_SESSION_MAX_AGE * 1000) {
        return null;
      }
      return token;
    },
    session({ session, token }) {
      return { ...session, uid: token.uid, cid: token.cid, sv: token.sv };
    },
  },
  pages: { signIn: "/login" },
});
