import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

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
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // script-src / style-src still allow 'unsafe-inline' — Next's hydration
      // bootstrap + Tailwind/Radix inline styles need it. Nonce-based tightening
      // lands in Phase 5-3.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src 'self'",
      "frame-ancestors 'self'",
      // Blocks legacy <object>/<embed>/<applet> — defense in depth vs. Flash-style XSS.
      "object-src 'none'",
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

// Serwist wraps the build to emit `public/sw.js` from `src/app/sw.ts`. The
// service worker is intentionally limited to the static asset precache +
// Serwist's safe runtime defaults — auth-sensitive routes (/api, /vault) are
// never cached. Disabled in dev so HMR isn't shadowed by a stale SW.
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV !== "production",
  exclude: [
    /\/api\//,
    /\/_next\/static\/.*\.map$/,
    // Auth + vault routes set Cache-Control: no-store via headers() — being
    // explicit here too belts the suspenders.
    /\/login(?:\/|$)/,
    /\/vault(?:\/|$)/,
  ],
});

export default withSerwist(nextConfig);
