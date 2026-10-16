import type { NextAuthConfig } from "next-auth";
import { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { UserRole } from "@/types";
import { loginSchema } from "@/features/auth/auth.schema";
import { displayName, verifyCredentials } from "@/features/auth/auth.service";
import { logAuditAction } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIpFromRequest } from "@/lib/request";

export class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limited";
}

const LOGIN_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 };

export const authConfig = {
  trustHost: true,
  providers: [
    Credentials({
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const ip = getClientIpFromRequest(request);

        // Limit both per account and per IP. This sits here rather than in the
        // login action so the NextAuth callback endpoint is covered too.
        const byEmail = rateLimit(`login:email:${email}`, LOGIN_LIMIT);
        const byIp = rateLimit(`login:ip:${ip ?? "unknown"}`, { ...LOGIN_LIMIT, limit: 50 });
        if (!byEmail.allowed || !byIp.allowed) {
          throw new RateLimitedSignin();
        }

        const user = await verifyCredentials(email, password);
        if (!user) {
          await logAuditAction({
            action: "USER_LOGIN_FAILED",
            resource: "users",
            details: `Failed login for ${email}`,
            ipAddress: ip,
          });
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          role: user.role as UserRole,
          name: displayName(user.firstName, user.lastName) || null,
        };
      },
    }),
  ],

  session: {
    strategy: "jwt",
    // Clinical systems should not keep sessions alive for weeks.
    maxAge: 8 * 60 * 60,
  },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.id = user.id;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as UserRole;
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",
  },
} satisfies NextAuthConfig;
