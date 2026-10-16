import "server-only";

import { headers } from "next/headers";

export type RequestMeta = {
  ipAddress: string | null;
  userAgent: string | null;
};

/**
 * The client IP, as recorded by our own reverse proxies. Each trusted proxy
 * appends the address it saw to X-Forwarded-For, so the client is the entry
 * TRUST_PROXY_HOPS places from the right; anything further left was sent by
 * the client and can be forged (it would otherwise defeat per-IP login limits
 * and put fake addresses in the audit trail). Default: one proxy in front.
 */
export function clientIp(forwardedFor: string | null, realIp: string | null, hops = trustedHops()): string | null {
  if (hops > 0 && forwardedFor) {
    const chain = forwardedFor.split(",").map((part) => part.trim()).filter(Boolean);
    const ip = chain[chain.length - hops] ?? chain[0];
    return ip ? ip.slice(0, 45) : null;
  }
  return realIp?.trim().slice(0, 45) || null;
}

function trustedHops(): number {
  const n = Number(process.env.TRUST_PROXY_HOPS ?? 1);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 1;
}

function ipFrom(get: (name: string) => string | null): string | null {
  return clientIp(get("x-forwarded-for"), get("x-real-ip"));
}

/** Client IP and user agent of the current request (null outside a request). */
export async function getRequestMeta(): Promise<RequestMeta> {
  try {
    const h = await headers();
    return {
      ipAddress: ipFrom((name) => h.get(name)),
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

export function requestMetaFrom(request: Request | undefined): RequestMeta {
  if (!request) return { ipAddress: null, userAgent: null };
  return {
    ipAddress: ipFrom((name) => request.headers.get(name)),
    userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
  };
}
