/**
 * Clears the vault PIN + lockout ledger so the next /vault visit runs the
 * setup flow. Requires shell access to the dev/prod machine — this is the
 * "I forgot my PIN" escape hatch for a single-user app.
 *
 * Run:  pnpm reset-vault-pin
 */
import { hash } from "@node-rs/argon2";
import { createInterface } from "node:readline/promises";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { settings, vaultPinAttempts, auditLog } from "../src/lib/db/schema";

const ALLOWED_EMAIL =
  (process.env.ALLOWED_LOGIN_EMAILS ?? process.env.ALLOWED_LOGIN_EMAIL ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)[0] ?? "cli:reset-vault-pin";

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const mode = (await rl.question("(1) Set a new PIN now, or (2) Clear PIN to trigger setup flow? [1/2]: ")).trim();

  if (mode === "2") {
    // Typed-confirm guard so a stray keystroke on the mode prompt can't
    // wipe the PIN + lockout ledger. Expected phrase is verbose and
    // distinct from anything you'd type accidentally.
    const confirm = (await rl.question(
      "\n⚠  About to wipe vault_pin_hash + vault_pin_attempts ledger.\n" +
      '    Type "CLEAR VAULT PIN" (exactly, including spaces) to continue, anything else to abort: ',
    )).trim();
    rl.close();
    if (confirm !== "CLEAR VAULT PIN") {
      console.log("✘ Aborted — confirmation did not match.");
      process.exit(1);
    }
    await db
      .update(settings)
      .set({ vaultPinHash: null, vaultPinSetAt: null, updatedAt: new Date() })
      .where(eq(settings.id, 1));
    await db.delete(vaultPinAttempts);
    await db.insert(auditLog).values({
      actorEmail: ALLOWED_EMAIL,
      action: "delete",
      target: "vault_pin:cli-clear",
      metadata: { source: "reset-vault-pin script" },
    });
    console.log("\n✔ Vault PIN cleared + lockout ledger wiped.");
    console.log("  Next /vault visit will prompt to set a new PIN.");
    return;
  }

  const pin = (await rl.question("New 6-digit vault PIN: ")).trim();
  rl.close();

  if (!/^\d{6}$/.test(pin)) {
    console.error("✘ PIN must be exactly 6 digits.");
    process.exit(1);
  }

  const hashed = await hash(pin, {
    algorithm: 2,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 4,
  });

  await db
    .update(settings)
    .set({ vaultPinHash: hashed, vaultPinSetAt: new Date(), updatedAt: new Date() })
    .where(eq(settings.id, 1));
  await db.delete(vaultPinAttempts);
  await db.insert(auditLog).values({
    actorEmail: ALLOWED_EMAIL,
    action: "update",
    target: "vault_pin:cli-reset",
    metadata: { source: "reset-vault-pin script" },
  });

  console.log("\n✔ Vault PIN reset + lockout ledger cleared.");
  console.log("  Sign out of any existing browser sessions and re-enter the new PIN.");
}

main().catch((e) => {
  console.error("✘", e);
  process.exit(1);
});
