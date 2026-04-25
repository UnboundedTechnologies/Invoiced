import { redirect } from "next/navigation";
import { readPendingUserId } from "@/lib/totp-pending";
import { TwoFactorForm } from "./twofa-form";

export default async function TwoFactorPage() {
  // Hard gate: only reachable when step 1 (password) succeeded and set the
  // __Host-2fa-pending cookie. Direct visits or expired sessions bounce home.
  const pendingUserId = await readPendingUserId();
  if (!pendingUserId) redirect("/login");

  return <TwoFactorForm />;
}
