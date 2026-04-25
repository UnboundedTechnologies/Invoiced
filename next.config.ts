import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  // Cross-origin isolation — COOP isolates the browsing context from cross-origin
  // popups; CORP restricts resources to same-origin fetches. We don't add
  // Cross-Origin-Embedder-Policy because it would block the in-app PDF iframe.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // Opts the origin into per-origin agent clusters (tightens Spectre-style leaks
  // across documents sharing a process).
  { key: "Origin-Agent-Cluster", value: "?1" },
  // NOTE: Content-Security-Policy is set per-request by src/middleware.ts so
  // it can include a rotating nonce for script-src. Don't duplicate it here.
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
    serverActions: { bodySizeLimit: "4mb" },
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
