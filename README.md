# Invoiced

> 🧾 Single-user toolbox for **[Unbounded Technologies Inc.](https://unboundedtechnologies.com)** — Ontario incorporation accounting, payroll, tax filings, and document vault, all in one private app.

🌐 **Live:** [invoiced.unboundedtechnologies.com](https://invoiced.unboundedtechnologies.com) &nbsp;·&nbsp; ✅ **Status:** In production

[![Next.js](https://img.shields.io/badge/Next.js-16-000?logo=next.js&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38BDF8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Auth.js](https://img.shields.io/badge/Auth.js-v5-7C3AED?logo=auth0&logoColor=white)](https://authjs.dev)
[![Drizzle](https://img.shields.io/badge/Drizzle-ORM-C5F74F?logo=drizzle&logoColor=black)](https://orm.drizzle.team)
[![Neon](https://img.shields.io/badge/Neon-Postgres-00E599?logo=postgresql&logoColor=white)](https://neon.tech)
[![Upstash](https://img.shields.io/badge/Upstash-Redis-00E9A3?logo=upstash&logoColor=white)](https://upstash.com)
[![Vercel](https://img.shields.io/badge/Vercel-Deployed-000?logo=vercel&logoColor=white)](https://vercel.com)
[![License](https://img.shields.io/badge/License-Private-lightgrey)](#-license)

---

## ✨ Features

- 📄 **Invoice generator** — branded PDFs, HST math, client management, payment tracking
- 💰 **Payroll** — salary planning, T4 slips, CPP/EI/tax withholding
- 💸 **Dividends** — eligible / non-eligible split, T5 slips, RDTOH tracking
- 🧮 **Tax helpers** — HST quarterly, T2 corporate, T1 personal, T1-ADJ amendments
- 📥 **Expenses** — categorized line items, GIFI mapping, attached receipts
- 🗄️ **Document vault** — PIN-gated encrypted storage for sensitive corp docs
- 📅 **Deadlines** — auto-calculated CRA, payroll, HST, instalment due dates
- 🤝 **Shareholder loan ledger** — section 15(2) / 15(2.6) compliance tracking
- 🛡️ **Audit log** — every login + write captured (IP, UA, before/after diff)

## 🛠️ Tech Stack

| Layer | Tech |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) (App Router · Turbopack) + [React 19](https://react.dev) |
| Language | [TypeScript 5.7](https://www.typescriptlang.org) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) (New York) |
| Auth | [Auth.js v5](https://authjs.dev) — credentials, Argon2id, JWT |
| Database | [Neon Postgres](https://neon.tech) + [Drizzle ORM](https://orm.drizzle.team) |
| Rate limiting | [Upstash Redis](https://upstash.com) + [@upstash/ratelimit](https://github.com/upstash/ratelimit) |
| File storage | [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) — private, signed URLs |
| PDFs | [@react-pdf/renderer](https://react-pdf.org) |
| Hosting | [Vercel](https://vercel.com) (Fluid Compute) |
| Observability | [Vercel Analytics](https://vercel.com/docs/analytics) + [Speed Insights](https://vercel.com/docs/speed-insights) |

## 🚀 First-run setup

> Requires **Node.js 20+** and **[pnpm](https://pnpm.io)**.

1. **Create `.env.local`** from `.env.example` and fill:
   - `DATABASE_URL` — Neon pooled connection string ([console.neon.tech](https://console.neon.tech))
   - `AUTH_SECRET` — generate with `openssl rand -base64 32` (or `npx auth secret`)
   - `ALLOWED_LOGIN_EMAILS` — comma-separated allowlist; first entry is admin
   - `ADMIN_PASSWORD_HASH` — see step 3
   - `BLOB_READ_WRITE_TOKEN` — from your [Vercel Blob store](https://vercel.com/docs/storage/vercel-blob)
   - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — from [console.upstash.com](https://console.upstash.com) (optional in dev, **required in prod**)
2. **Push schema** — `pnpm db:push`
3. **Set your password** — `pnpm set-password`, then paste the output into `ADMIN_PASSWORD_HASH`
4. **Seed data** — `pnpm seed`
5. **Run** — `pnpm dev` → http://localhost:3000

## 🔐 Security

- 🔑 **Argon2id** hashing with 64 MB memory cost (`@node-rs/argon2`)
- 🚪 **Single-user lockdown** — every login checked against `ALLOWED_LOGIN_EMAILS` server-side; only the first (admin) entry can bootstrap from env
- ⏱️ **Failed-login lockout** — 5 attempts / 15 min, enforced via Upstash rate limiter
- 🛡️ **Strict CSP**, HSTS, `X-Frame-Options: DENY`
- 📦 **Private file storage** — Vercel Blob with signed, expiring URLs
- 📜 **Audit log** on every login and every write
- 🆔 **SIN never persisted** — director's SIN is rendered as a blank marker on T-slips for CRA Web Forms re-keying

## 🌍 Production deploy (Vercel)

1. **Neon** → create branch `production` → copy the pooled connection string.
2. **Locally**, push the schema and seed prod:
   ```bash
   DATABASE_URL=<prod-url> pnpm db:push
   DATABASE_URL=<prod-url> pnpm seed
   ```
3. **Vercel** → Import the repo (framework: **Next.js**). Set Production env vars before first deploy:
   - `DATABASE_URL` (prod Neon pooled)
   - `AUTH_SECRET` (fresh `openssl rand -base64 32`, **not** the dev one)
   - `ALLOWED_LOGIN_EMAILS` (admin first, comma-separated)
   - `ADMIN_PASSWORD_HASH` (new hash via `pnpm set-password`)
   - `BLOB_READ_WRITE_TOKEN`
   - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
   - `AUTH_URL` / `NEXTAUTH_URL` — fill after first deploy exposes the URL
4. **Deploy.** Add the custom domain under *Project → Domains*; set `AUTH_URL = https://<your-domain>` and redeploy.
5. **DNS** (e.g. `invoiced.unboundedtechnologies.com` on Cloudflare): add a `CNAME` → `cname.vercel-dns.com`, **proxy OFF** (DNS only).
6. **Adding a visitor account** — append the email to `ALLOWED_LOGIN_EMAILS`, then:
   ```bash
   DATABASE_URL=<prod-url> pnpm set-password visitor@example.com
   ```
   Remove later with `pnpm remove-user visitor@example.com`.

## 🧪 Verification

```bash
pnpm verify-all       # run every checker
pnpm verify-math      # invoice / HST math
pnpm verify-payroll   # T4, CPP/EI, withholdings
pnpm verify-t1        # personal return
pnpm verify-t2        # corporate return
pnpm verify-coherence # cross-page numerical consistency
```

## 📜 License

Private — © Unbounded Technologies Inc. All rights reserved. This repository is published openly for transparency; no public license is granted.
