/**
 * Resets the admin user's password directly in the DB.
 * Use this when you've forgotten the current password OR want to change it
 * after the user row has already been bootstrapped from .env.local.
 *
 * Run:  pnpm reset-password
 */
import { hash } from "@node-rs/argon2";
import { createInterface } from "node:readline/promises";
import { db } from "../src/lib/db/client";
import { users, auditLog } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

const ALLOWED_EMAIL = process.env.ALLOWED_LOGIN_EMAIL?.toLowerCase();

async function main() {
  if (!ALLOWED_EMAIL) {
    console.error("✘ ALLOWED_LOGIN_EMAIL is not set in .env.local");
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pw = await rl.question("New admin password (min 12 chars): ");
  rl.close();

  if (!pw || pw.length < 12) {
    console.error("✘ Password must be at least 12 characters.");
    process.exit(1);
  }

  const hashed = await hash(pw, {
    algorithm: 2,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 4,
  });

  const existing = await db.select().from(users).where(eq(users.email, ALLOWED_EMAIL));
  if (existing.length === 0) {
    await db.insert(users).values({ email: ALLOWED_EMAIL, passwordHash: hashed });
    console.log(`✔ Created new user row for ${ALLOWED_EMAIL}.`);
  } else {
    await db
      .update(users)
      .set({ passwordHash: hashed, failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.email, ALLOWED_EMAIL));
    console.log(`✔ Password updated for ${ALLOWED_EMAIL}. Lockout cleared.`);
  }

  await db.insert(auditLog).values({
    actorEmail: ALLOWED_EMAIL,
    action: "update",
    target: "users:password_reset",
    metadata: { source: "reset-password script" },
  });

  console.log("\nYou can now sign in at http://localhost:3000/login");
}

main().catch((e) => {
  console.error("✘", e);
  process.exit(1);
});
