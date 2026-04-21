"use server";

import { signIn, signOut } from "../../../auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { VAULT_PIN_COOKIE } from "@/lib/vault-pin";

export async function loginAction(_prev: { error?: string } | undefined, formData: FormData) {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirect: false,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return { error: "Invalid email or password." };
    }
    return { error: "Something went wrong. Please try again." };
  }
  redirect("/dashboard");
}

export async function logoutAction() {
  // Clear the vault PIN cookie alongside the main session so nothing
  // persists across a logout/login boundary.
  const c = await cookies();
  c.delete(VAULT_PIN_COOKIE);
  await signOut({ redirectTo: "/login" });
}
