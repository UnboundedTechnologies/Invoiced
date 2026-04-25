import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verify } from "@node-rs/argon2";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { db } from "@/lib/db/client";
import { users, auditLog } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { checkLoginRateLimit } from "@/lib/rate-limit";
import {
  setPendingCookie,
  readPendingUserId,
  clearPendingCookie,
} from "@/lib/totp-pending";
import {
  decryptSecret,
  verifyTotp,
  verifyAndConsumeBackupCode,
} from "@/lib/totp";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(256),
});

const ALLOWED_EMAILS = (process.env.ALLOWED_LOGIN_EMAILS ?? process.env.ALLOWED_LOGIN_EMAIL ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const ADMIN_EMAIL = ALLOWED_EMAILS[0];
const ENV_HASH = process.env.ADMIN_PASSWORD_HASH;

const TOTP_LOCKOUT_THRESHOLD = 5;
const TOTP_LOCKOUT_MINUTES = 15;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        mode: { type: "text" },
        code: { type: "text" },
      },
      async authorize(rawCreds) {
        const mode = typeof rawCreds?.mode === "string" ? rawCreds.mode : "";

        // ── Step 2: 2FA completion ──────────────────────────────────────────
        // /login/2fa calls signIn("credentials", { mode: "2fa" | "2fa-backup", code }).
        // We trust the pending cookie (HMAC-signed, 60s TTL) for the userId — the
        // password was already verified in step 1 below.
        if (mode === "2fa" || mode === "2fa-backup") {
          const userId = await readPendingUserId();
          if (!userId) return null;
          const code = String(rawCreds?.code ?? "").replace(/\s+/g, "");
          const [user] = await db.select().from(users).where(eq(users.id, userId));
          if (!user || !user.totpEnabledAt || !user.totpSecretEncrypted) return null;

          // Lockout gate (5 fails / 15 min on 2FA specifically).
          if (user.totpLockedUntil && user.totpLockedUntil > new Date()) {
            await db.insert(auditLog).values({
              actorEmail: user.email,
              action: "login",
              metadata: { success: false, step: "2fa", reason: "locked" },
            });
            return null;
          }

          const key = process.env.TOTP_ENCRYPTION_KEY;
          if (!key) return null;

          let ok = false;
          let usedBackup = false;
          if (mode === "2fa") {
            try {
              const secret = decryptSecret(user.totpSecretEncrypted, key);
              ok = /^\d{6}$/.test(code) && verifyTotp(secret, code);
            } catch {
              ok = false;
            }
          } else {
            const remaining = await verifyAndConsumeBackupCode(
              code,
              user.totpBackupCodesHashed ?? [],
            );
            if (remaining !== null) {
              ok = true;
              usedBackup = true;
              await db
                .update(users)
                .set({ totpBackupCodesHashed: remaining })
                .where(eq(users.id, user.id));
            }
          }

          if (!ok) {
            const newCount = (user.totpFailedCount ?? 0) + 1;
            const locked =
              newCount >= TOTP_LOCKOUT_THRESHOLD
                ? new Date(Date.now() + TOTP_LOCKOUT_MINUTES * 60 * 1000)
                : null;
            await db
              .update(users)
              .set({ totpFailedCount: newCount, totpLockedUntil: locked })
              .where(eq(users.id, user.id));
            await db.insert(auditLog).values({
              actorEmail: user.email,
              action: "login",
              metadata: { success: false, step: "2fa", mode },
            });
            return null;
          }

          await db
            .update(users)
            .set({
              totpFailedCount: 0,
              totpLockedUntil: null,
              lastLoginAt: new Date(),
            })
            .where(eq(users.id, user.id));
          await db.insert(auditLog).values({
            actorEmail: user.email,
            action: "login",
            metadata: { success: true, step: "2fa", mode, usedBackup },
          });
          await clearPendingCookie();
          return { id: user.id, email: user.email };
        }

        // ── Step 1: email + password ────────────────────────────────────────
        const rl = await checkLoginRateLimit();
        if (!rl.success) {
          await db.insert(auditLog).values({
            actorEmail: `rate-limited:${rl.identifier}`,
            action: "login",
            metadata: { success: false, reason: "ip-rate-limit" },
            ipAddress: rl.identifier,
          });
          return null;
        }

        const parsed = loginSchema.safeParse(rawCreds);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const normalizedEmail = email.toLowerCase();

        if (!ALLOWED_EMAILS.length || !ALLOWED_EMAILS.includes(normalizedEmail)) {
          return null;
        }

        let userId: string | null = null;
        let storedHash: string | null = null;

        const rows = await db.select().from(users).where(eq(users.email, normalizedEmail));
        const userRow = rows[0];

        if (userRow) {
          if (userRow.lockedUntil && userRow.lockedUntil > new Date()) return null;
          userId = userRow.id;
          storedHash = userRow.passwordHash;
        } else if (ENV_HASH && normalizedEmail === ADMIN_EMAIL) {
          storedHash = ENV_HASH;
          const inserted = await db
            .insert(users)
            .values({ email: normalizedEmail, passwordHash: ENV_HASH })
            .returning({ id: users.id });
          userId = inserted[0]!.id;
        } else {
          return null;
        }

        const ok = await verify(storedHash, password);

        if (!ok) {
          if (userId) {
            await db
              .update(users)
              .set({
                failedLoginCount: sql`${users.failedLoginCount} + 1`,
                lockedUntil: sql`CASE WHEN ${users.failedLoginCount} + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE ${users.lockedUntil} END`,
              })
              .where(eq(users.id, userId));
            await db.insert(auditLog).values({
              actorEmail: normalizedEmail,
              action: "login",
              metadata: { success: false },
            });
          }
          return null;
        }

        // Password verified. If user has 2FA enrolled, set the pending cookie
        // and return null — the loginAction wrapper inspects the cookie and
        // redirects to /login/2fa instead of treating null as a generic fail.
        if (userRow?.totpEnabledAt) {
          await setPendingCookie(userRow.id);
          await db.insert(auditLog).values({
            actorEmail: normalizedEmail,
            action: "login",
            metadata: { success: true, step: "password", twofa: "pending" },
          });
          return null;
        }

        // No 2FA: issue session immediately (existing flow).
        await db
          .update(users)
          .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
          .where(eq(users.id, userId!));
        await db.insert(auditLog).values({
          actorEmail: normalizedEmail,
          action: "login",
          metadata: { success: true },
        });

        return { id: userId!, email: normalizedEmail };
      },
    }),
  ],
});
