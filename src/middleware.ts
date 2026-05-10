import NextAuth from "next-auth";
import { authConfig } from "../auth.config";

// Edge-safe auth handler — uses authConfig (no DB calls). Next 16 requires
// the middleware export to be a function declaration / default export, not
// a destructured const.
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  matcher: [
    // Skip middleware on Next.js internals + public assets + crawler files +
    // PWA icon/manifest/splash/service-worker. Without the PWA exclusions iOS
    // 307-bounces to /login on apple-icon fetches and falls back to Safari's
    // generated "first letter of title" icon (white I on dark) for the
    // home-screen tile. Same logic for manifest.json + sw.js — blocking them
    // silently breaks installability.
    "/((?!_next/static|_next/image|favicon\\.ico|apple-touch-icon.*|apple-icon.*|icon.*|manifest\\.json|splash/.*|sw\\.js|swe-worker-.*|robots\\.txt|sitemap\\.xml|\\.well-known|logo.*|banner.*|sprites/.*).*)",
  ],
};
