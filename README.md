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
   - `ALLOWED_LOGIN_EMAILS` — comma-separated login allowlist; first entry is admin
   - `ADMIN_PASSWORD_HASH` — see step 3
2. **Push schema:** `pnpm db:push`
3. **Set your password:** `pnpm set-password` → paste output into `ADMIN_PASSWORD_HASH`
4. **Seed data:** `pnpm seed`
5. **Run:** `pnpm dev` → http://localhost:3000

## Security

- Argon2id, 64 MB memory cost
- Single-user lockdown via `ALLOWED_LOGIN_EMAILS` (server-side check on every login); only the first (admin) entry can bootstrap from env
- Failed-login lockout after 5 attempts / 15 min
- Strict CSP, HSTS, X-Frame-Options DENY
- All file uploads stored as Vercel Blob with signed, expiring URLs
- Audit log on every login + write

## Production deploy (Vercel)

1. **Neon** → new branch `production` → copy the pooled connection string.
2. **Locally**: `DATABASE_URL=<prod-url> pnpm db:push && DATABASE_URL=<prod-url> pnpm seed`.
3. **Vercel** → Import the repo → framework: Next.js. Before first deploy, set Production env vars:
   - `DATABASE_URL` (prod Neon pooled)
   - `AUTH_SECRET` (fresh `openssl rand -base64 32`, not the dev one)
   - `ALLOWED_LOGIN_EMAILS` (admin email first, comma-separated if adding visitors)
   - `ADMIN_PASSWORD_HASH` (new hash via `pnpm set-password`, not the dev one)
   - `BLOB_READ_WRITE_TOKEN`
   - `AUTH_URL` / `NEXTAUTH_URL` — fill after first deploy exposes the URL
4. Deploy. Once live, add the custom domain under Project → Domains; set `AUTH_URL` = `https://<your-domain>` and redeploy.
5. **Cloudflare DNS** (for a custom subdomain like `invoiced.unboundedtechnologies.com`): add a `CNAME` record → target `cname.vercel-dns.com` → proxy OFF (DNS only).
6. **Adding a visitor account**: add their email to `ALLOWED_LOGIN_EMAILS`, then point the CLI at prod and create their row:
   ```
   DATABASE_URL=<prod-url> pnpm set-password visitor@example.com
   ```
   Remove later with `pnpm remove-user visitor@example.com`.
