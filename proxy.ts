import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, createNonce } from "@/lib/csp";

// Optimistic routing only: checks that the right session cookie is present
// and sends people to the matching sign-in page. The cookie is validated
// (and clinic suspension, account status, permissions re-checked against the
// database) in every page guard and server action - never here.

const CLINIC_COOKIES = ["medflow.clinic", "__Secure-medflow.clinic"];
const PLATFORM_COOKIES = ["medflow.platform", "__Secure-medflow.platform"];

function hasCookie(req: NextRequest, names: string[]) {
  return names.some((name) => req.cookies.has(name));
}

/** Lets the request through with a fresh CSP nonce (read by Next and the root layout). */
function allow(req: NextRequest) {
  const nonce = createNonce();
  const csp = contentSecurityPolicy(nonce, {
    dev: process.env.NODE_ENV === "development",
    https: (process.env.AUTH_URL ?? req.nextUrl.origin).startsWith("https://"),
  });
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Server Actions are POSTs to the page they live on and authorize themselves.
  if (req.method === "POST" && req.headers.has("next-action")) {
    return NextResponse.next();
  }

  if (pathname === "/platform/login" || pathname === "/login") {
    return allow(req);
  }

  if (pathname === "/platform" || pathname.startsWith("/platform/")) {
    if (!hasCookie(req, PLATFORM_COOKIES)) {
      return NextResponse.redirect(new URL("/platform/login", req.url));
    }
    return allow(req);
  }

  if (!hasCookie(req, CLINIC_COOKIES)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return allow(req);
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      // Link prefetches render no HTML of their own.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
