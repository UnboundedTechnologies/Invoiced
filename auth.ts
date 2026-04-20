import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verify } from "@node-rs/argon2";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { db } from "@/lib/db/client";
import { users, auditLog } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(256),
});

const ALLOWED_EMAIL = process.env.ALLOWED_LOGIN_EMAIL?.toLowerCase();
const ENV_HASH = process.env.ADMIN_PASSWORD_HASH;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(rawCreds) {
        const parsed = loginSchema.safeParse(rawCreds);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const normalizedEmail = email.toLowerCase();

        // Single-user lockdown: email must match the env allowlist
        if (!ALLOWED_EMAIL || normalizedEmail !== ALLOWED_EMAIL) {
          return null;
        }

        // Resolve hash: prefer DB row, fall back to env (bootstrap before first login)
        let userId: string | null = null;
        let storedHash: string | null = null;

        const rows = await db.select().from(users).where(eq(users.email, normalizedEmail));
        const userRow = rows[0];

        if (userRow) {
          if (userRow.lockedUntil && userRow.lockedUntil > new Date()) return null;
          userId = userRow.id;
          storedHash = userRow.passwordHash;
        } else if (ENV_HASH) {
          // First-run bootstrap: insert from env hash
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
