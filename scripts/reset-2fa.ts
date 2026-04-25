/**
 * Wipe TOTP 2FA for a specific user account. The "lost my phone, also lost
 * my backup codes" escape hatch — needs shell access to the dev/prod box.
 *
 * Clears: totp_secret_encrypted, totp_backup_codes_hashed, totp_enabled_at,
 * totp_failed_count, totp_locked_until. The user is dropped back to a no-2FA
 * state; their next login uses email + password only, and they can re-enroll
 * from /settings.
 *
 * Run:  pnpm reset-2fa
 */
import { createInterface } from "node:readline/promises";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { users, auditLog } from "../src/lib/db/schema";

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const emailRaw = (await rl.question("Email of the user to reset 2FA for: ")).trim();
  const email = emailRaw.toLowerCase();
  if (!email) {
    rl.close();
    console.error("✘ No email provided.");
    process.exit(1);
  }

  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) {
    rl.close();
    console.error(`✘ No user found with email: ${email}`);
    process.exit(1);
  }

  if (!user.totpEnabledAt && !user.totpSecretEncrypted) {
    rl.close();
    console.log(`✔ ${email} doesn't have 2FA enabled. Nothing to do.`);
    return;
  }

  const confirm = (await rl.question(
    `\n⚠  About to wipe 2FA secret + backup codes for ${email}.\n` +
      '    Type "RESET 2FA" (exactly, including space) to continue, anything else to abort: ',
  )).trim();
  rl.close();

  if (confirm !== "RESET 2FA") {
    console.log("✘ Aborted — confirmation did not match.");
    process.exit(1);
  }

  await db
    .update(users)
    .set({
      totpSecretEncrypted: null,
      totpBackupCodesHashed: null,
      totpEnabledAt: null,
      totpFailedCount: 0,
      totpLockedUntil: null,
    })
    .where(eq(users.id, user.id));

  await db.insert(auditLog).values({
    actorEmail: "cli:reset-2fa",
    action: "delete",
    target: `users:${user.id}:2fa-cli-reset`,
    metadata: { email, source: "reset-2fa script" },
  });

  console.log(`\n✔ 2FA wiped for ${email}.`);
  console.log("  Next login will be password-only; re-enroll from /settings → Security.");
}

main().catch((e) => {
  console.error("✘", e);
  process.exit(1);
});
