import NextAuth from "next-auth";
import { authConfig } from "../auth.config";

// Edge-safe auth handler — uses authConfig (no DB calls). Next 16 requires
// the middleware export to be a function declaration / default export, not
// a destructured const.
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.*|banner.*).*)"],
};
