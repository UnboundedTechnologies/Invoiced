/**
 * Hashes a password with Argon2id and prints the hash for you to paste
 * into ADMIN_PASSWORD_HASH in .env.local.
 *
 * Usage:
 *   pnpm set-password
 *   (you'll be prompted; the password is NOT stored anywhere)
 *
 * Note: in Git Bash on Windows the password may echo as you type.
 * Clear shell history afterwards with:  history -c
 */
import { hash } from "@node-rs/argon2";
import { createInterface } from "node:readline/promises";

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pw = await rl.question("New admin password (min 12 chars): ");
  rl.close();

  if (!pw || pw.length < 12) {
    console.error("✘ Password must be at least 12 characters.");
    process.exit(1);
  }

  // Argon2id, OWASP-recommended params
  const hashed = await hash(pw, {
    algorithm: 2, // Argon2id
    memoryCost: 65_536, // 64 MB
    timeCost: 3,
    parallelism: 4,
  });

  console.log("\n ADMIN_PASSWORD_HASH ");
  console.log(hashed);
  console.log("");
  console.log("\nPaste the line above into .env.local under ADMIN_PASSWORD_HASH=...");
  console.log('Wrap it in quotes:  ADMIN_PASSWORD_HASH="<paste>"');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
