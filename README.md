# Unbounded Technologies Inc. · Invoiced

[![React Doctor](https://github.com/UnboundedTechnologies/Invoiced/actions/workflows/react-doctor.yml/badge.svg?branch=main)](https://github.com/UnboundedTechnologies/Invoiced/actions/workflows/react-doctor.yml)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/React-19-149eca?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind-v4-06b6d4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Auth.js v5](https://img.shields.io/badge/Auth.js-v5-7C3AED?logo=auth0&logoColor=white)](https://authjs.dev)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle-ORM-C5F74F?logo=drizzle&logoColor=black)](https://orm.drizzle.team)
[![Neon Postgres](https://img.shields.io/badge/Neon-Postgres-00E599?logo=postgresql&logoColor=white)](https://neon.tech)
[![Hosted on Vercel](https://img.shields.io/badge/hosted%20on-Vercel-000000?logo=vercel)](https://vercel.com)
[![License](https://img.shields.io/badge/License-Proprietary-lightgrey)](./LICENSE)

> Single-user corporate-finance toolbox for an Ontario CCPC: invoicing, payroll, dividends, HST, T2, T1, year-end slips, and a 2FA-gated document vault — all in one private app.

The internal accounting platform for **[Unbounded Technologies Inc.](https://unboundedtechnologies.com)**, a Toronto cloud + CPaaS engineering firm. Built as a single-user replacement for QuickBooks + spreadsheets + a tax accountant, with Canada-specific tax engines (CRA T4127 PDOC, CCA pool engine, GRIP / RDTOH / CDA tax pools, SBD grind, GIFI CSV export) and a hardened auth path (Argon2id + mandatory TOTP + private Blob proxy).

## Live site

- Production: https://invoiced.unboundedtechnologies.com
- Status: in production (single tenant, allowlisted login)

## Highlights

- **Invoice generator** with branded PDFs, HST math, per-week or per-total quantity modes, client management, and payment tracking.
- **Payroll engine** running CRA T4127 (Jan 2026) PDOC math with CPP1 / CPP2, owner-manager EI = 0, monthly remittance auto-creation, and paystub PDFs.
- **Dividend ledger** with eligible / non-eligible split, gross-up + DTC, and declaration-timing helpers.
- **Shareholder loan ledger** (T4A box 117) with ITA s.15(2) / 15(2.6) deadlines, s.80.4 quarterly interest accruals, and series detection.
- **Expense tracker** with categorised line items, CCA pool capture (classes 8 / 10 / 10.1 / 12 / 50), and a receipt vault.
- **HST returns** with a Regular vs Quick Method break-even advisor, line-by-line CRA mapping, and filing lock.
- **Corporate tax (T2)** with full CCA pool engine, GRIP / ERDTOH / NERDTOH / CDA tax pools, SBD grind, and GIFI CSV export for the accountant.
- **Personal tax (T1)** federal + Ontario, RRSP / FHSA, Schedule 3 capital gains, donations + medical, T1-ADJ amendments.
- **Year-end slip generator** for T4 + T5 + T4A (PDFs + CSV) with per-slip filing locks and a dashboard countdown.
- **Self-pay planner** simulating salary / dividend mix client-side, sha256-pinned scenarios with drift detection, AAII + Holdco-QSBC countdown.
- **PSB risk module** with a 10-item checklist, 12-month trend, and contract-form gates on risky billing models.
- **Live dashboard** with FY revenue trend, est. corp tax, cash position, and deadline alerts.
- **Deadlines calendar** auto-derived from T2 / HST / T4 / annual return + manual entries, month + list views.
- **Document vault** PIN + TOTP-gated, with contract attachments and parent-flow auto-population.
- **Mandatory TOTP 2FA** at first login and on every vault unlock; AES-256-GCM at rest, ±30 s drift, 10 single-use Argon2id-hashed backup codes.
- **PWA + Web Push** installable to the iOS / iPad home screen, with an animated cosmic login background and daily push notifications for upcoming deadlines (iOS 16.4+).
- **Audit log** capturing every login, 2FA verify, vault unlock, write, and download (IP, UA, jsonb metadata; PII-clean enforced by `pnpm verify-audit-metadata`).

## Stack

- **Framework**: Next.js 16 App Router (Turbopack dev, Webpack build) + React 19
- **Language**: TypeScript 6 (strict)
- **Styling**: Tailwind CSS v4 + shadcn/ui (New York)
- **Auth**: Auth.js v5 — credentials, Argon2id (`@node-rs/argon2`), JWT sessions, TOTP 2FA via `otplib`
- **Database**: Neon Postgres + Drizzle ORM (dev / production branches)
- **Rate limiting**: Upstash Redis + `@upstash/ratelimit` (sliding window, fails open)
- **File storage**: Vercel Blob — **private** store, streamed via SDK `get()` through auth-gated proxy routes (no direct URL exposure even on leak)
- **PDFs**: `@react-pdf/renderer` — invoices, paystubs, T2 / T1 / HST returns, T4 / T5 / T4A slips
- **PWA + Push**: `@serwist/next` service worker + `web-push` (VAPID), daily Vercel Cron for deadline reminders
- **Hosting**: Vercel (Fluid Compute, daily Cron via `vercel.json`)
- **Observability**: Vercel Analytics + Speed Insights
- **Tooling**: pnpm, ESLint (eslint-config-next), `tsx` for ops scripts, `drizzle-kit` for schema push

## Project structure

```
src/
  app/
    (app)/                       Authenticated app shell (sidebar layout)
      dashboard/                 Live dashboard (revenue, est. corp tax, deadlines)
      invoices/, clients/        Invoice generator + client CRUD
      paycheques/                Payroll engine (T4127 PDOC, CPP1/CPP2, remittances)
      dividends/                 T5 dividend ledger (eligible / non-eligible split)
      shareholder-loan/          ITA s.15(2) / 80.4 ledger + T4A box 117
      expenses/                  Expense tracker + CCA pool capture
      hst/                       HST returns (Regular vs Quick Method)
      corp-tax/                  T2: CCA engine, GRIP/RDTOH/CDA pools, GIFI export
      personal-tax/              T1 federal + Ontario, RRSP/FHSA, Sch 3
      slips/                     Year-end T4 / T5 / T4A generator + filing locks
      planner/                   Self-pay simulator (sha256-pinned scenarios)
      psb/                       PSB risk module (10-item checklist + 12-mo trend)
      calendar/                  Deadline calendar (auto-derived + manual entries)
      vault/                     PIN + 2FA-gated document vault
      settings/                  Account, password, 2FA, push notifications
    (auth)/                      Login + onboarding (TOTP enrolment wizard)
    api/
      auth/                      Auth.js v5 handlers
      contracts/                 Contract HTML/PDF generation
      cron/                      Daily push for upcoming deadlines (CRON_SECRET-gated)
      documents/                 Auth-gated Blob proxy (streams SDK get())
      expenses/, invoices/       Receipt + invoice/paystub stream routes
      paycheques/, slips/        Payroll mutations + T4/T5/T4A slip + CSV
    sw.ts                        Serwist service worker
    layout.tsx                   Root layout (theme + analytics + Speed Insights)
  components/
    ui/                          shadcn/ui primitives (New York)
    invoices/, paycheques/, ... One folder per domain feature
    app-sidebar.tsx, top-bar.tsx Sidebar + top bar (running-Charmander pill, etc.)
  lib/
    db/, queries/                Drizzle schema + server-only data accessors
    payroll-2026.ts              T4127 PDOC math, CPP1/CPP2, EI=0
    t1.ts / t1-pdf.tsx / t1-rates-2026.ts   Personal tax engine + PDF
    t2.ts / t2-pdf.tsx / t2-rates.ts        Corporate tax engine + PDF
    cca.ts                       CCA pool engine (classes 8/10/10.1/12/50)
    hst.ts / hst-pdf.tsx         Regular vs Quick Method engine + PDF
    shareholder-loan.ts          ITA s.15(2) + 80.4 series detection
    self-pay-planner.ts          Salary/dividend simulator + cash waterfall
    slip-boxes.ts / slip-csv.ts  T4/T5/T4A box derivations + CSV export
    psb.ts                       Personal services business risk model
    totp.ts                      AES-256-GCM TOTP secret + backup-code helpers
    vault-pin.ts / vault-2fa-session.ts     Vault three-factor gate (session → PIN → 2FA)
    optimistic-lock.ts           Version-check helper for every mutable table
    rate-limit.ts                Upstash sliding-window limiter (fails open)
    blob.ts                      Vercel Blob private SDK wrapper
    deadlines-derivation.ts      T2 / HST / T4 / annual return derivation
    dashboard-metrics.ts         FY rollups + Ontario rate proration
    gifi-export.ts               GIFI CSV builder for the accountant
  server/actions/                Server Actions (write paths)
  middleware.ts                  Auth + login rate-limit edge entry
scripts/                         Verify suite + ops scripts (set-password, seed, ...)
drizzle/                         Generated migrations
public/                          PWA icons, splash screens, logo, vault assets
.github/workflows/               react-doctor.yml (CI score gate)
```

## Local development

> Requires **Node.js 22+** (Vercel runs Node 24 LTS) and **[pnpm](https://pnpm.io)**.

```bash
pnpm install
cp .env.example .env.local       # fill in the values below
pnpm db:push                     # push Drizzle schema to your Neon dev branch
pnpm set-password                # paste output into ADMIN_PASSWORD_HASH
pnpm seed                        # seed corporate facts + sample data
pnpm gen-pwa-assets              # icons + iOS splash screens from public/logo.png
pnpm dev                         # turbopack dev server at http://localhost:3000
```

`.env.local` keys (full list in `.env.example`):

- `DATABASE_URL` — Neon pooled connection string ([console.neon.tech](https://console.neon.tech))
- `AUTH_SECRET` — `openssl rand -base64 32` (or `npx auth secret`)
- `ALLOWED_LOGIN_EMAILS` — comma-separated allowlist; first entry is admin
- `ADMIN_PASSWORD_HASH` — output of `pnpm set-password`
- `BLOB_READ_WRITE_TOKEN` — from your **private** Vercel Blob store
- `TOTP_ENCRYPTION_KEY` — `openssl rand -base64 32`; AES-256-GCM key for the 2FA secret column
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` — `node -e "console.log(require('web-push').generateVAPIDKeys())"`
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — optional in dev, **required in prod**

> Schema changes go to **both** Neon branches (dev + production) in the same session: `DATABASE_URL=<dev-url> pnpm db:push` then `DATABASE_URL=<prod-url> pnpm db:push`. Vercel reads from the production branch directly.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server with Turbopack |
| `pnpm build` | Production build (Webpack — `@react-pdf/renderer` is not Turbopack-clean yet) |
| `pnpm start` | Run production build locally on :3000 |
| `pnpm lint` | ESLint (eslint-config-next) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm db:push` | Push Drizzle schema to the configured `DATABASE_URL` |
| `pnpm db:studio` | Drizzle Studio against the configured `DATABASE_URL` |
| `pnpm seed` | Seed corporate facts + sample data |
| `pnpm set-password [email]` | Hash a password with Argon2id; defaults to admin if no email |
| `pnpm reset-password [email]` | Wipe + reissue a user password hash |
| `pnpm remove-user <email>` | Delete a non-admin login |
| `pnpm reset-vault-pin` | Wipe vault PIN (escape hatch) |
| `pnpm reset-2fa <email>` | Wipe TOTP secret + backup codes for an account |
| `pnpm gen-pwa-assets` | Regenerate iOS splash screens from `public/logo.png`. (PWA icons are now owned by `gen-brand-assets`; running this after will revert the icons to the old emblem.) |
| `pnpm gen-brand-assets` | Regenerate the iPhone brand assets (app icon, Apple ID photo, Contact Poster, Home + Lock wallpapers, Landing-repo icon twin) into `public/brand-assets/` and promote the Invoiced app icon to the canonical PWA paths (`apple-touch-icon.png` + `icons/icon-*.png`) so iOS Add-to-Home picks it up. Source artwork: `public/banner.png`. |
| `pnpm cleanup-blobs` | Sweep orphaned Vercel Blob files |
| `pnpm cleanup-phantom-docs` | Remove `documents` rows whose blob is 404 |
| `pnpm gen-tax-pdf` | Regenerate the canonical `TAX_OPTIMIZATION.pdf` playbook |
| `pnpm verify-all` | Chain all 16 pure-logic verifiers below (~250 assertions). Typecheck not included; run `pnpm typecheck` separately |
| `pnpm verify-math` | Invoice / HST math, business-day quantities |
| `pnpm verify-payroll` | T4, CPP1/CPP2, federal + ON withholdings, OHP tiers |
| `pnpm verify-t1` | Personal return: gross-up, DTC, RRSP, Sch 3, donations |
| `pnpm verify-t2` | Corporate: SBD grind, CCA pool engine, GRIP/RDTOH/CDA |
| `pnpm verify-slips` | T4 / T5 / T4A box derivations + CSV export |
| `pnpm verify-loans` | ITA s.15(2) / 80.4 / series detection |
| `pnpm verify-hst` | Regular vs Quick Method, eligibility, period math |
| `pnpm verify-deadlines` | T2 / HST / T4 / annual return derivation, leap-day handling |
| `pnpm verify-vault` / `verify-vault-pin` | Category whitelist + Argon2id PIN HMAC token round-trip |
| `pnpm verify-totp` | 2FA AES-GCM round-trip, drift, backup codes |
| `pnpm verify-optimistic-lock` | Version conflict detection across mutable tables |
| `pnpm verify-planner` | Self-pay simulator + cash waterfall identity |
| `pnpm verify-audit-metadata` | PII-clean guard on `audit_log.metadata` |
| `pnpm verify-dashboard` | Revenue rollup, Ontario rate proration |
| `pnpm verify-coherence` | Cross-page numerical consistency (HST line 101 ≡ FY revenue ≡ dashboard ≡ T2 façade) |

## CI gates

One GitHub Actions workflow guards `main`:

| Workflow | Triggered on | Asserts |
|---|---|---|
| `react-doctor.yml` | every push to `main` + PRs | Runs the React Doctor scan and posts the score back to the PR. Floor gate: score ≥ 75 (PRs and pushes to `main` fail below this). Most remaining findings are intentional design intent (PDF route GET side-effects, animated peripheral UI). |

Dependabot (`.github/dependabot.yml`) opens grouped weekly PRs for npm + GitHub Actions. Branch protection and secret scanning are intentionally off (single-user, free-tier).

## Architecture notes

A few decisions worth knowing before editing.

- **Auth uses Auth.js v5 with credentials only, hard-allowlisted by email.** Every login is checked against `ALLOWED_LOGIN_EMAILS` server-side; only the first (admin) entry can bootstrap from `ADMIN_PASSWORD_HASH`. Visitor accounts are created out-of-band via `pnpm set-password visitor@example.com` against the prod Neon URL. There is no signup form; the surface is intentionally tiny.
- **The vault has a three-factor gate: session → PIN cookie → 2FA cookie.** Both cookies are 60 s with sliding refresh on every authenticated action; idle past TTL triggers an auto-refresh that surfaces the unlock prompt. Every read and write on `/vault/*` re-validates all three.
- **Every mutable table version-checks on UPDATE/DELETE via `optimistic-lock.ts`.** Stale-tab edits surface a friendly refresh prompt rather than silently overwriting. New mutations should follow the 5-question checklist in memory (`project_audit_findings.md`).
- **Numbers that appear on more than one page derive from one shared slice.** Status / period / FY filters are never duplicated. The `pnpm verify-coherence` checker enforces this: HST line 101 ≡ FY revenue ≡ dashboard ≡ T2 façade.
- **Director SIN is never persisted.** T-slip PDFs render a blank marker for CRA Web Forms re-keying. Do not add a `sin` column; do not log SINs anywhere.
- **PDF generation runs on Vercel Functions (Node), not Edge.** `@react-pdf/renderer` and the binary blob streams need full Node. The build is on Webpack rather than Turbopack for the same reason.
- **Web Push uses Serwist + VAPID with a daily Cron** (`/api/cron/*`, `CRON_SECRET`-gated by Vercel) that fans out per-subscription pushes for deadlines firing in the next 14 days. iOS 16.4+ only.

## Deployment

`main` auto-deploys to Vercel. Production env vars expected by the code:

```
DATABASE_URL                  Neon production pooled connection string
AUTH_SECRET                   openssl rand -base64 32 (NOT the dev one)
AUTH_URL / NEXTAUTH_URL       https://<your-domain>  (set after first deploy)
ALLOWED_LOGIN_EMAILS          comma-separated; first entry is admin
ADMIN_PASSWORD_HASH           output of `pnpm set-password` against prod
BLOB_READ_WRITE_TOKEN         private Vercel Blob store
TOTP_ENCRYPTION_KEY           AES-256-GCM key for the 2FA secret column (Sensitive)
NEXT_PUBLIC_VAPID_PUBLIC_KEY  public, no Sensitive flag
VAPID_PRIVATE_KEY             Sensitive
VAPID_SUBJECT                 e.g. mailto:you@example.com
UPSTASH_REDIS_REST_URL        /login rate limit
UPSTASH_REDIS_REST_TOKEN      paired with UPSTASH_REDIS_REST_URL
CRON_SECRET                   auto-injected by Vercel on first deploy with vercel.json crons
```

First-deploy steps:

1. **Neon** → create branch `production` → copy the pooled connection string.
2. Locally, push the schema and seed prod:
   ```bash
   DATABASE_URL=<prod-url> pnpm db:push
   DATABASE_URL=<prod-url> pnpm seed
   ```
3. **Vercel** → Import the repo (framework: **Next.js**), set the env vars above before first deploy.
4. **Deploy.** Add the custom domain under *Project → Domains*; set `AUTH_URL = https://<your-domain>` and redeploy.
5. **DNS** (e.g. `invoiced.unboundedtechnologies.com` on Cloudflare): `CNAME` → `cname.vercel-dns.com`, **proxy OFF** (DNS only).
6. **Adding a visitor account** — append the email to `ALLOWED_LOGIN_EMAILS`, then `DATABASE_URL=<prod-url> pnpm set-password visitor@example.com`. Remove later with `pnpm remove-user visitor@example.com`.

Operational SOPs (rotation, incident response, Neon PITR drill) live in [`SECURITY_RUNBOOK.md`](./SECURITY_RUNBOOK.md).

## Security

- **Argon2id hashing** (64 MB / 3 iter / 4 lanes) on passwords, vault PINs, and backup codes (`@node-rs/argon2`).
- **Single-user lockdown** — every login checked against `ALLOWED_LOGIN_EMAILS` server-side; only the first (admin) entry can bootstrap from `ADMIN_PASSWORD_HASH`.
- **Mandatory TOTP 2FA** — first-login wizard forces enrolment before any app access. Required again on every vault unlock (defense-in-depth above the PIN). AES-256-GCM at rest under `TOTP_ENCRYPTION_KEY`, ±30 s drift, 10 single-use Argon2id-hashed backup codes per enrolment, 5/15-min lockout shared with login.
- **IP rate-limit on `/login`** — 10 attempts / 10 min sliding window via Upstash Redis (fails open if Upstash is unreachable).
- **Vault three-factor gate** — session → PIN cookie → 2FA cookie. Both cookies are 60 s with sliding refresh on every authenticated action.
- **Private file storage** — Vercel Blob private store, streamed via SDK `get()` through auth-gated proxy routes (no direct URL exposure even on leak).
- **Security headers** — HSTS preload, COOP / CORP same-origin, Origin-Agent-Cluster, CSP `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`.
- **Audit log** — every login, 2FA verify, vault unlock, write, and download (`audit_log` table; PII-clean enforced by `pnpm verify-audit-metadata`).
- **Optimistic locking** — every mutable table version-checks on UPDATE/DELETE; stale-tab edits surface a friendly refresh prompt.
- **SIN never persisted** — director's SIN renders as a blank marker on T-slips for CRA Web Forms re-keying.
- **Responsible disclosure** — see [SECURITY.md](./SECURITY.md); please **do not** open public issues for vulnerabilities.

## Contributing

This is a single-tenant private app, but issues and PRs are welcome:

- [Bug report](https://github.com/UnboundedTechnologies/Invoiced/issues/new?template=bug.yml)
- [Feature request](https://github.com/UnboundedTechnologies/Invoiced/issues/new?template=feature.yml)
- [Security advisory](./SECURITY.md)

## License

© 2026 Unbounded Technologies Inc. All rights reserved. See [LICENSE](./LICENSE).

This is **proprietary code** for a single business. The repo is published openly so the engineering can be audited, but the code is not licensed for reuse, redistribution, or derivative works without written permission.

---

Built by [Saïd Aïssani](https://www.linkedin.com/in/said-aissani/) · contact@unboundedtechnologies.com · Toronto, Canada
