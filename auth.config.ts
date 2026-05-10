import type { NextAuthConfig } from "next-auth";

/**
 * Edge-compatible auth config.
 * Pure JWT strategy → no DB lookup in middleware.
 * Heavy work (DB + Argon2id verify) lives in auth.ts (Node runtime).
 */
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 8, // 8 hours
    updateAge: 60 * 30, // refresh JWT every 30 min of activity
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnLogin = nextUrl.pathname.startsWith("/login");
      const isOnApi = nextUrl.pathname.startsWith("/api");
      // Mirrors the middleware matcher exclusions in src/middleware.ts.
      // Defense-in-depth — if a PWA asset slips through the matcher it still
      // returns 200 instead of bouncing iOS to the login page.
      const isStatic =
        nextUrl.pathname.startsWith("/_next") ||
        nextUrl.pathname === "/favicon.ico" ||
        nextUrl.pathname.startsWith("/apple-touch-icon") ||
        nextUrl.pathname.startsWith("/apple-icon") ||
        nextUrl.pathname.startsWith("/icon") ||
        nextUrl.pathname === "/manifest.json" ||
        nextUrl.pathname.startsWith("/splash/") ||
        nextUrl.pathname === "/sw.js" ||
        nextUrl.pathname.startsWith("/swe-worker-") ||
        nextUrl.pathname.startsWith("/logo") ||
        nextUrl.pathname.startsWith("/banner") ||
        nextUrl.pathname.startsWith("/sprites/");

      if (isOnLogin) return isLoggedIn ? Response.redirect(new URL("/dashboard", nextUrl)) : true;
      if (isStatic || isOnApi) return true;
      return isLoggedIn;
    },
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.email = user.email;
      }
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      if (token.email) session.user.email = token.email as string;
      return session;
    },
  },
  providers: [], // populated in auth.ts (Node runtime)
} satisfies NextAuthConfig;
