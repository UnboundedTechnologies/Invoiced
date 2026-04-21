import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

// Prevent browser back/forward cache (bfcache) from restoring a vault page
// after the user has locked it. `no-store` tells the browser to never reuse
// the response; combined with the client-side pageshow handler this gives
// belt-and-braces against "press Back → see unlocked vault" leaks.
const noStoreHeaders = [
  { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, private" },
  { key: "Pragma", value: "no-cache" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: {
    position: "bottom-right",
  },
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
  },
  serverExternalPackages: ["@node-rs/argon2", "@react-pdf/renderer"],
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      { source: "/vault", headers: noStoreHeaders },
      { source: "/vault/:path*", headers: noStoreHeaders },
      { source: "/api/documents/:path*", headers: noStoreHeaders },
    ];
  },
};

export default nextConfig;
