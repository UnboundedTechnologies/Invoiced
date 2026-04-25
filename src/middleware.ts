import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "../auth.config";

// Edge-safe auth handler — uses authConfig (no DB calls). Wrapped so the
// same middleware both:
//   (a) enforces the authorized() callback (redirects unauth'd traffic)
//   (b) generates a per-request CSP nonce so script-src can drop 'unsafe-inline'
//
// The `authorized` callback in auth.config.ts still runs first; if it returns
// true, this wrapper runs and injects CSP + x-nonce onto the response.
const { auth } = NextAuth(authConfig);

// Static CSP directives — don't depend on the per-request nonce. Kept out of
// the hot path so the middleware does as little per-request work as possible.
const CSP_STATIC_DIRECTIVES = [
  "default-src 'self'",
  // style-src keeps 'unsafe-inline' — Tailwind v4 / Radix inject inline styles
  // at runtime that have no nonce channel. Nonce-style-src is impractical in
  // Next 16's app router.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export default auth(async (req) => {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  // script-src: nonce-allowlist + strict-dynamic. Modern browsers that support
  // strict-dynamic IGNORE 'unsafe-inline' when a nonce is also present, so the
  // fallback doesn't weaken security on them. Old pre-strict-dynamic browsers
  // fall through to 'unsafe-inline' — acceptable trade-off for a private app
  // used only by the corp admin + accountant reviewers.
  const scriptSrc = `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' https:`;
  const csp = `${scriptSrc}; ${CSP_STATIC_DIRECTIVES}`;

  // Forward the nonce to React so Next.js / our own <Script> components can
  // stamp it into inline scripts via headers().get("x-nonce").
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.*|banner.*).*)"],
};
