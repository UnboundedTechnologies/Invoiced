"use server";

import { signIn, signOut } from "../../../auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { VAULT_PIN_COOKIE } from "@/lib/vault-pin";
import { readPendingUserId, clearPendingCookie } from "@/lib/totp-pending";
import { clearVault2faCookie } from "@/lib/vault-2fa-session";

export async function loginAction(_prev: { error?: string } | undefined, formData: FormData) {
  const emailRaw = String(formData.get("email") ?? "").toLowerCase();
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirect: false,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      // authorize() returns null when 2FA is needed — but it sets the pending
      // cookie first. Distinguish "wrong password" from "2FA required" by
      // checking whether the cookie landed.
      const pendingUserId = await readPendingUserId();
      if (pendingUserId) redirect("/login/2fa");
      return { error: "Invalid email or password." };
    }
    return { error: "Something went wrong. Please try again." };
  }

  // Successful sign-in. If the user hasn't enrolled 2FA yet, skip the
  // dashboard hop and go straight to the forced-enrolment page (the
  // (app)/layout would redirect there anyway, this just avoids the bounce).
  if (emailRaw) {
    const [me] = await db
      .select({ totpEnabledAt: users.totpEnabledAt })
      .from(users)
      .where(eq(users.email, emailRaw));
    if (!me?.totpEnabledAt) redirect("/onboard/2fa");
  }
  redirect("/dashboard");
}

export async function login2faAction(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string } | undefined> {
  const mode = String(formData.get("mode") ?? "2fa");
  const code = String(formData.get("code") ?? "").replace(/\s+/g, "");
  try {
    await signIn("credentials", { mode, code, redirect: false });
  } catch (e) {
    if (e instanceof AuthError) {
      // signIn throws for null returns — meaning the code was wrong or the
      // pending cookie expired. Either way we surface a generic error.
      return { error: "Invalid code or session expired. Try logging in again." };
    }
    return { error: "Something went wrong. Please try again." };
  }
  redirect("/dashboard");
}

/** Cancel the in-flight 2FA step and bounce back to the login page. */
export async function cancel2faAction() {
  await clearPendingCookie();
  redirect("/login");
}

export async function logoutAction() {
  // Clear the vault PIN cookie alongside the main session. Explicit attribute
  // match required — `__Host-` cookies ignore bare c.delete() in some browsers.
  const c = await cookies();
  c.set({
    name: VAULT_PIN_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    // Must match the original set-attributes (sameSite=strict in vault-pin.ts).
    // __Host- cookie deletion is silently dropped by some browsers when the
    // delete-call attributes don't match what was used at issue time.
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  // Clear any half-completed 2FA pending cookie too, and the vault 2FA cookie.
  await clearPendingCookie();
  await clearVault2faCookie();
  await signOut({ redirectTo: "/login" });
}
