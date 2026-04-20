# Invoiced

Single-user toolbox for **Unbounded Technologies Inc.** (Ontario incorporation).
Modules: invoice generator, salary/dividend tools, HST/T2/T1 helpers, expenses, vault, deadlines.

## Stack

- Next.js 15 (App Router) + TypeScript
- Tailwind v4 + shadcn/ui (New York)
- Auth.js v5 (single-user credentials, Argon2id, JWT)
- Drizzle ORM + Neon Postgres
- @react-pdf/renderer for invoices/pay stubs
- Vercel deployment + Vercel Blob (private file storage)

## First-run setup (Phase 0)

1. **Create `.env.local`** at the project root by copying `.env.example`. Fill:
   - `DATABASE_URL` — Neon pooled connection string
   - `AUTH_SECRET` — generate with `openssl rand -base64 32` (or `npx auth secret`)
   - `ALLOWED_LOGIN_EMAIL` — the only email allowed to log in
   - `ADMIN_PASSWORD_HASH` — see step 3
2. **Push schema:** `pnpm db:push`
3. **Set your password:** `pnpm set-password` → paste output into `ADMIN_PASSWORD_HASH`
4. **Seed data:** `pnpm seed`
5. **Run:** `pnpm dev` → http://localhost:3000

## Security

- Argon2id, 64 MB memory cost
- Single-user lockdown via `ALLOWED_LOGIN_EMAIL` (server-side check on every login)
- Failed-login lockout after 5 attempts / 15 min
- Strict CSP, HSTS, X-Frame-Options DENY
- All file uploads stored as Vercel Blob with signed, expiring URLs
- Audit log on every login + write
