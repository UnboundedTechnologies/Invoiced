/**
 * Removes a users row by email.
 *
 *   pnpm remove-user <email>
 *
 * Used to clean up test/visitor accounts once they're no longer needed.
 * The email does NOT need to still be in ALLOWED_LOGIN_EMAILS — this script
 * just deletes whatever users row matches. Prompts for confirmation.
 */
import { createInterface } from "node:readline/promises";
import { db } from "../src/lib/db/client";
import { users, auditLog } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const emailArg = process.argv[2]?.trim().toLowerCase();
  if (!emailArg) {
    console.error("✘ Usage: pnpm remove-user <email>");
    process.exit(1);
  }

  const existing = await db.select().from(users).where(eq(users.email, emailArg));
  if (existing.length === 0) {
    console.log(`⊘ No users row found for ${emailArg}. Nothing to remove.`);
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const confirm = await rl.question(`Delete users row for ${emailArg}? Type the email to confirm: `);
  rl.close();

  if (confirm.trim().toLowerCase() !== emailArg) {
    console.log("✘ Confirmation did not match. Aborted.");
    process.exit(1);
  }

  await db.delete(users).where(eq(users.email, emailArg));
  await db.insert(auditLog).values({
    actorEmail: emailArg,
    action: "delete",
    target: "users:remove",
    metadata: { source: "remove-user script" },
  });

  console.log(`✔ Removed users row for ${emailArg}.`);
  console.log(`Reminder: also drop ${emailArg} from ALLOWED_LOGIN_EMAILS in your env.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
