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

- 📄 **Invoice generator** — branded PDFs, HST math, per-week or per-total quantity modes, client management, payment tracking
- 💰 **Payroll (T4)** — CRA T4127 (Jan 2026) PDOC math, CPP1/CPP2, owner-manager EI=0, monthly remittance auto-creation
- 💸 **Dividends (T5)** — eligible / non-eligible split, gross-up + DTC, declaration timing
- 🤝 **Shareholder loan ledger (T4A box 117)** — ITA s.15(2) / 15(2.6) deadlines + s.80.4 quarterly accruals + series detection
- 📥 **Expenses** — categorised line items, CCA pool capture (classes 8/10/10.1/12/50), receipt vault
- 🧮 **HST returns** — Regular vs Quick Method break-even advisor, line-by-line CRA mapping, filing lock
- 🏛️ **Corporate tax (T2)** — full CCA pool engine, GRIP/ERDTOH/NERDTOH/CDA tax pools, SBD grind, GIFI CSV export
- 👤 **Personal tax (T1)** — federal + Ontario, RRSP/FHSA, Schedule 3 capital gains, donations + medical, T1-ADJ amendments
- 📅 **Year-end slip generator** — T4 + T5 + T4A PDFs, slip filing locks, dashboard countdown
- 🎯 **Self-pay planner** — simulate salary/dividend mix client-side, pin scenarios with sha256 drift detection, AAII + Holdco-QSBC countdown
- 🛡️ **PSB risk module** — 10-item checklist + 12-month trend, contract-form gates on risky billing models
- 📊 **Live dashboard** — FY revenue trend, est. corp tax, cash position, deadline alerts
- 📅 **Deadlines calendar** — auto-derived T2 / HST / T4 / annual return + manual entries, month + list views
- 🗄️ **Document vault** — PIN + TOTP-gated, contract attachments, parent-flow auto-population
- 🔐 **2FA / TOTP** — mandatory on first login + every vault unlock; AES-256-GCM at rest; backup codes
- 📱 **PWA** — installable as iPhone/iPad app via Add to Home Screen, animated cosmic login background, daily push notifications for upcoming deadlines (iOS 16.4+)
- 📜 **Audit log** — every login, 2FA verify, write, and download captured (IP, UA, jsonb metadata)

## 🛠️ Tech Stack

| Layer | Tech |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) (App Router · Turbopack) + [React 19](https://react.dev) |
| Language | [TypeScript 5.7](https://www.typescriptlang.org) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) (New York) |
| Auth | [Auth.js v5](https://authjs.dev) — credentials, Argon2id, JWT, TOTP 2FA via [otplib](https://github.com/yeojz/otplib) |
| Database | [Neon Postgres](https://neon.tech) + [Drizzle ORM](https://orm.drizzle.team) |
| Rate limiting | [Upstash Redis](https://upstash.com) + [@upstash/ratelimit](https://github.com/upstash/ratelimit) |
| File storage | [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) — **private** store, streamed via SDK `get()` through auth-gated proxy routes |
| PDFs | [@react-pdf/renderer](https://react-pdf.org) — invoices, paystubs, T2/T1/HST returns, T4/T5/T4A slips |
| PWA + Push | [@serwist/next](https://serwist.pages.dev) service worker + [web-push](https://github.com/web-push-libs/web-push) (VAPID) |
| Hosting | [Vercel](https://vercel.com) (Fluid Compute, daily Cron) |
| Observability | [Vercel Analytics](https://vercel.com/docs/analytics) + [Speed Insights](https://vercel.com/docs/speed-insights) |

## 🚀 First-run setup

> Requires **Node.js 20+** and **[pnpm](https://pnpm.io)**.

1. **Create `.env.local`** from `.env.example` and fill:
   - `DATABASE_URL` — Neon pooled connection string ([console.neon.tech](https://console.neon.tech))
   - `AUTH_SECRET` — generate with `openssl rand -base64 32` (or `npx auth secret`)
   - `ALLOWED_LOGIN_EMAILS` — comma-separated allowlist; first entry is admin
   - `ADMIN_PASSWORD_HASH` — see step 3
   - `BLOB_READ_WRITE_TOKEN` — from your **private** Vercel Blob store
   - `TOTP_ENCRYPTION_KEY` — generate with `openssl rand -base64 32`; AES-256-GCM key for the 2FA secret column
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` — generate via `node -e "console.log(require('web-push').generateVAPIDKeys())"`; needed for Web Push
   - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — from [console.upstash.com](https://console.upstash.com) (optional in dev, **required in prod**)
2. **Push schema** — `pnpm db:push`
3. **Set your password** — `pnpm set-password`, then paste the output into `ADMIN_PASSWORD_HASH`
4. **Seed data** — `pnpm seed`
5. **Generate PWA assets** — `pnpm gen-pwa-assets` (icons + splash screens from `public/logo.png`)
6. **Run** — `pnpm dev` → http://localhost:3000

## 🔐 Security

- 🔑 **Argon2id** hashing (64 MB / 3 iter / 4 lanes) on passwords, vault PINs, and backup codes (`@node-rs/argon2`)
- 🚪 **Single-user lockdown** — every login checked against `ALLOWED_LOGIN_EMAILS` server-side; only the first (admin) entry can bootstrap from `ADMIN_PASSWORD_HASH`
- 🔐 **Mandatory TOTP 2FA** — first-login wizard forces enrolment before any app access. Required again on every vault unlock (defense-in-depth above the PIN). AES-256-GCM at rest under `TOTP_ENCRYPTION_KEY`, ±30 s drift, 10 single-use argon2id-hashed backup codes per enrolment, 5/15-min lockout shared with login
- ⏱️ **IP rate-limit on /login** — 10 attempts / 10 min sliding window via Upstash Redis (fails-open if Upstash is unreachable)
- 🔒 **Vault three-factor gate** — session → PIN cookie → 2FA cookie. Both cookies are 60 s with sliding refresh on every authenticated action; idle past TTL triggers an auto-refresh that surfaces the unlock prompt
- 📦 **Private file storage** — Vercel Blob private store, streamed via SDK `get()` through auth-gated proxy routes (no direct URL exposure even on leak)
- 🛡️ **Headers** — HSTS preload, COOP/CORP same-origin, Origin-Agent-Cluster, CSP `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`
- 📜 **Audit log** — every login, 2FA verify, vault unlock, write, and download (`audit_log` table; PII-clean enforced by `pnpm verify-audit-metadata`)
- 🔁 **Optimistic locking** — every mutable table version-checks on UPDATE/DELETE; stale-tab edits surface as a friendly refresh prompt
- 🆔 **SIN never persisted** — director's SIN renders as a blank marker on T-slips for CRA Web Forms re-keying

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
   - `BLOB_READ_WRITE_TOKEN` — provision a **Private** Vercel Blob store (Storage → Create Database → Blob → Private)
   - `TOTP_ENCRYPTION_KEY` (fresh `openssl rand -base64 32`; mark **Sensitive**)
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (public, no Sensitive flag)
   - `VAPID_PRIVATE_KEY` (mark **Sensitive**)
   - `VAPID_SUBJECT` (e.g. `mailto:you@example.com`)
   - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
   - `AUTH_URL` / `NEXTAUTH_URL` — fill after first deploy exposes the URL
   - `CRON_SECRET` — auto-injected by Vercel on first deploy with `vercel.json` crons configured
4. **Deploy.** Add the custom domain under *Project → Domains*; set `AUTH_URL = https://<your-domain>` and redeploy.
5. **DNS** (e.g. `invoiced.unboundedtechnologies.com` on Cloudflare): add a `CNAME` → `cname.vercel-dns.com`, **proxy OFF** (DNS only).
6. **Adding a visitor account** — append the email to `ALLOWED_LOGIN_EMAILS`, then:
   ```bash
   DATABASE_URL=<prod-url> pnpm set-password visitor@example.com
   ```
   Remove later with `pnpm remove-user visitor@example.com`.

## 🧪 Verification

`pnpm verify-all` chains 16 pure-logic checkers (~250 assertions total):

```bash
pnpm verify-all              # run every checker (typecheck not included; run pnpm typecheck separately)
pnpm verify-math             # invoice / HST math, business-day quantities
pnpm verify-payroll          # T4, CPP1/CPP2, federal+ON withholdings, OHP tiers
pnpm verify-t1               # personal return: gross-up, DTC, RRSP, Sch 3, donations
pnpm verify-t2               # corporate: SBD grind, CCA pool engine, GRIP/RDTOH/CDA
pnpm verify-slips            # T4 / T5 / T4A box derivations + CSV export
pnpm verify-loans            # ITA s.15(2) / 80.4 / series detection
pnpm verify-hst              # Regular vs Quick Method, eligibility, period math
pnpm verify-deadlines        # T2 / HST / T4 / annual return derivation, leap-day handling
pnpm verify-vault            # vault category whitelist, formatting helpers
pnpm verify-vault-pin        # PIN HMAC token sign/verify/tamper, Argon2id round-trip
pnpm verify-totp             # 2FA AES-GCM round-trip, drift, backup codes
pnpm verify-optimistic-lock  # version conflict detection across mutable tables
pnpm verify-planner          # self-pay simulator + cash waterfall identity
pnpm verify-audit-metadata   # PII-clean guard on audit_log.metadata
pnpm verify-dashboard        # revenue rollup, Ontario rate proration
pnpm verify-coherence        # cross-page numerical consistency (HST line 101 ≡ FY revenue ≡ dashboard ≡ T2 façade)
```

Other operational scripts:

```bash
pnpm gen-pwa-assets          # regenerate PWA icons + iOS splash screens from public/logo.png
pnpm cleanup-blobs           # sweep orphaned Vercel Blob files
pnpm cleanup-phantom-docs    # remove documents rows whose blob is 404
pnpm reset-vault-pin         # CLI escape hatch — wipe vault PIN
pnpm reset-2fa <email>       # CLI escape hatch — wipe TOTP for an account
```

## 📜 License

Private — © Unbounded Technologies Inc. All rights reserved. This repository is published openly for transparency; no public license is granted.
