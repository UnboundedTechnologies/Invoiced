# Security Policy

Invoiced is a single-tenant production app handling Canadian corporate +
personal tax data, payroll, and financial documents. We take security
reports seriously even though the surface area is one user.

## Reporting a Vulnerability

**Please do not file public GitHub issues for security problems.**

Instead, send a private report to **security@unboundedtechnologies.com**
with:

- A description of the issue and its impact
- Steps to reproduce (or a proof-of-concept)
- The commit SHA you tested against
- Your name / handle if you would like credit

We aim to:

- **Acknowledge** within 72 hours
- **Triage + initial assessment** within 7 days
- **Fix or mitigate** critical issues within 30 days

If you do not get a reply within 7 days, ping
hello@unboundedtechnologies.com as a fallback.

## Supported Versions

Only the current `main` branch and the live deployment at
[invoiced.unboundedtechnologies.com](https://invoiced.unboundedtechnologies.com)
are supported. Older commits / forks receive no security updates.

## Scope

In scope:

- Authentication, session, vault PIN, and TOTP 2FA logic
- Server actions, API routes, cron handlers
- Database queries (Drizzle ORM) — SQL injection, broken access control
- Vercel Blob proxy routes — URL leakage, IDOR
- Cryptographic primitives (Argon2id, AES-256-GCM, HMAC, TOTP)
- Headers, CSRF, CSP, COOP/CORP
- Audit log integrity
- Rate limiting bypass

Out of scope:

- Social engineering of the single user
- DoS / volumetric attacks against Vercel infra (handled upstream)
- Findings against archived / unmaintained dependencies that have no
  exploitable path in this app
- Issues that require a privileged session and add no privilege
- Best-practice nits (header hardening, etc.) — file these as issues, not
  vulnerabilities

## Security Posture

The repo is a **public, single-user** project on GitHub Free:

- **Dependabot** is enabled for security updates only (see
  [`.github/dependabot.yml`](./.github/dependabot.yml))
- Branch protection and secret scanning are intentionally **off** — single
  developer, all merges from `main`
- Cryptographic secrets live exclusively in Vercel project env (Production
  and Preview); `.env.local` is gitignored
- Rotation runbooks for `AUTH_SECRET`, `TOTP_ENCRYPTION_KEY`,
  `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`, and database credentials are
  documented in the operator's `SECURITY_RUNBOOK.md` (gitignored — it
  contains operational fingerprints)
- Neon Postgres has Point-in-Time Recovery enabled; restore drills are
  exercised periodically

## Hall of Fame

No reports yet. Be the first :)
