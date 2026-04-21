/**
 * Two modes:
 *
 *   pnpm set-password
 *     → prompts for password, prints the Argon2id hash to paste into
 *       ADMIN_PASSWORD_HASH in .env.local. Use for first-time admin bootstrap.
 *
 *   pnpm set-password <email>
 *     → prompts for password, upserts a users row for <email> directly in the
 *       database. Use to create additional allowlisted users (test visitors,
 *       etc.) without round-tripping through env bootstrap. The email must
 *       already be listed in ALLOWED_LOGIN_EMAILS, otherwise login will be
 *       rejected.
 *
 * Note: in Git Bash on Windows the password may echo as you type.
 * Clear shell history afterwards with:  history -c
 */
import { hash } from "@node-rs/argon2";
import { createInterface } from "node:readline/promises";

const ARGON2 = {
  algorithm: 2 as const, // Argon2id
  memoryCost: 65_536, // 64 MB
  timeCost: 3,
  parallelism: 4,
};

async function main() {
  const emailArg = process.argv[2]?.trim().toLowerCase();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const label = emailArg ? `Password for ${emailArg} (min 12 chars): ` : "New admin password (min 12 chars): ";
  const pw = await rl.question(label);
  rl.close();

  if (!pw || pw.length < 12) {
    console.error("✘ Password must be at least 12 characters.");
    process.exit(1);
  }

  const hashed = await hash(pw, ARGON2);

  if (!emailArg) {
    console.log("\n ADMIN_PASSWORD_HASH ");
    console.log(hashed);
    console.log("");
    console.log("\nPaste the line above into .env.local under ADMIN_PASSWORD_HASH=...");
    console.log('Wrap it in quotes:  ADMIN_PASSWORD_HASH="<paste>"');
    return;
  }

  // Email mode — upsert a users row. Import DB lazily so the bootstrap path
  // above still runs when DATABASE_URL is not yet set.
  const { db } = await import("../src/lib/db/client");
  const { users, auditLog } = await import("../src/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const existing = await db.select().from(users).where(eq(users.email, emailArg));
  if (existing.length === 0) {
    await db.insert(users).values({ email: emailArg, passwordHash: hashed });
    console.log(`✔ Created users row for ${emailArg}.`);
  } else {
    await db
      .update(users)
      .set({ passwordHash: hashed, failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.email, emailArg));
    console.log(`✔ Updated password for ${emailArg}. Lockout cleared.`);
  }

  await db.insert(auditLog).values({
    actorEmail: emailArg,
    action: "update",
    target: "users:set_password",
    metadata: { source: "set-password script" },
  });

  console.log(`\nReminder: ${emailArg} must also be in ALLOWED_LOGIN_EMAILS to sign in.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
