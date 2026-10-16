// Content Security Policy, built per request with a fresh nonce (proxy.ts).
//
// Scripts: only Next's own (carrying the nonce) and what they load
//   ('strict-dynamic'). An injected <script> without the nonce never runs.
// Styles: 'unsafe-inline' is required - React style attributes, Radix
//   dialogs, Recharts and toasts use inline styles. A nonce is deliberately
//   not added here: browsers ignore 'unsafe-inline' once a nonce is present.
// No third-party origins: every request the browser makes is to this app.

export function createNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

export function contentSecurityPolicy(nonce: string, options: { dev: boolean; https: boolean }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only upgrade when the app is actually served over https; on a plain
    // http install it would make every asset fail to load.
    ...(options.https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
