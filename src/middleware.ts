import NextAuth from "next-auth";
import { authConfig } from "../auth.config";

// Edge-safe auth handler — uses authConfig (no DB calls). Next 16 requires
// the middleware export to be a function declaration / default export, not
// a destructured const.
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  matcher: [
    // Skip middleware on Next.js internals + public assets + crawler files.
    // Without robots.txt + sitemap.xml in the exclusion list, the auth
    // matcher 307-redirects them to /login → SEO + Lighthouse audits fail.
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|\\.well-known|logo.*|banner.*|sprites/.*).*)",
  ],
};
