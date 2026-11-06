import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  experimental: {
    // forbidden() / unauthorized() for real 403 responses on refused pages.
    authInterrupts: true,
    serverActions: {
      // Lab documents: 10 MB a file, sent one at a time, plus the form around it.
      // Patient register imports send their CSV (max 2 MB) the same way.
      bodySizeLimit: "11mb",
    },
    // proxy.ts buffers each request body; past this limit it is cut short.
    proxyClientMaxBodySize: "11mb",
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
