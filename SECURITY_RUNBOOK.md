# Security Runbook — Invoiced

> Owner: Saïd Aïssani · Last reviewed: 2026-04-24 (Phase 5 close)
> Scope: production rotation SOPs, incident response, Neon backup/restore drill,
> and a record of what shipped in Phase 5.

This runbook is the single source of truth for "something is wrong, what do I
do?" Keep it short and operational — every section ends in commands you can
copy-paste. Update it whenever an env var, vendor, or threat model changes.

---

## 0. Inventory — what's protecting Invoiced

| Layer | Mechanism | Where |
|---|---|---|
| Identity | Auth.js v5 credentials + Argon2id, 8h JWT | `auth.ts`, `auth.config.ts` |
| Allowlist | `ALLOWED_LOGIN_EMAILS` env (CSV) | Vercel env |
| Brute-force defense | Upstash sliding window — 10 attempts / 10 min / IP | `src/lib/rate-limit.ts` |
| Vault re-auth | Argon2id PIN + 60s non-sliding cookie, `SameSite=strict` | `src/server/actions/vault-pin.ts` |
| Transport | HSTS preload, COOP/CORP same-origin, Origin-Agent-Cluster | `next.config.ts` |
| Content | CSP `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'` | `next.config.ts` |
| Audit | `audit_log` (action + target + ip + UA + jsonb metadata) | `src/lib/db/schema.ts:764` |
| PII guard | `pnpm verify-audit-metadata` blocks forbidden keys in `audit_log.metadata` | `scripts/verify-audit-metadata.ts` |
| Storage | Vercel Blob (private, token-gated) for PDFs | `BLOB_READ_WRITE_TOKEN` |
| Crawlers | `public/robots.txt` Disallow + `<meta robots noindex>` | `src/app/layout.tsx:14` |

Production env vars (audit run 2026-04-24, all encrypted, prod-only):
`AUTH_SECRET`, `AUTH_URL`, `NEXTAUTH_URL`, `DATABASE_URL`,
`ADMIN_PASSWORD_HASH`, `ALLOWED_LOGIN_EMAILS`, `BLOB_READ_WRITE_TOKEN`,
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.

No preview/development env scope is populated — if you ever add one, mirror
test-only credentials, never production.

---

## 1. Key rotation SOPs

Run each of these on a normal cadence (suggest every 6 months) and immediately
on any suspected leak. Each rotation lists: **why**, **steps**, **verify**.

### 1.1 `AUTH_SECRET` — JWT signing key

Rotating this invalidates every active session. Forces re-login.

```bash
# 1. Generate a new 32-byte secret
openssl rand -base64 32

# 2. Update Vercel (production scope)
vercel env rm AUTH_SECRET production
vercel env add AUTH_SECRET production
# paste the new value when prompted

# 3. Mirror locally for dev parity
# edit .env.local → AUTH_SECRET=<new>

# 4. Trigger a redeploy so the running instances pick up the new secret
vercel --prod

# 5. Verify
#    - Try the live site → existing tab gets bounced to /login (expected)
#    - Sign in fresh → session works
```

### 1.2 `ADMIN_PASSWORD_HASH` — primary login password

```bash
# 1. Pick a new password (use a password manager). Hash it locally:
pnpm set-password unboundedtechnologies@gmail.com
#    Prints the Argon2id hash. The script also writes the users row in dev DB.
#    For prod, copy the hash only — do not run the script against prod DB
#    (it would also overwrite the dev row, which is fine, but be intentional).

# 2. Update Vercel
vercel env rm ADMIN_PASSWORD_HASH production
vercel env add ADMIN_PASSWORD_HASH production
# paste the new hash

# 3. Redeploy
vercel --prod

# 4. Verify: log in with the new password
```

The bootstrap path (`auth.ts` → `bootstrapAdminFromEnvHash`) only fires if the
admin row doesn't yet exist. After first login, the hash lives in the `users`
table; the env var is a recovery tool. To force re-bootstrap, delete the
admin row first via a Neon SQL console.

### 1.3 `BLOB_READ_WRITE_TOKEN` — Vercel Blob

```bash
# 1. Vercel dashboard → Storage → invoiced-blob → Settings → Rotate token
#    (CLI rotation isn't supported as of 2026-04; UI only.)

# 2. The token in the project's env auto-syncs from the Storage panel.
#    Pull a fresh copy locally:
vercel env pull .env.production.local --environment=production

# 3. Redeploy to apply
vercel --prod

# 4. Verify: download an existing PDF + upload a new T4/T5 slip → both work.
#    Old token is invalidated immediately, so any stale Blob URL with embedded
#    auth in the query string will 401.
```

### 1.4 Upstash Redis REST URL + token

```bash
# 1. console.upstash.com → invoiced-rl → Details → REST API → "Reset Token"
#    (URL only changes if you destroy + recreate the DB — usually keep URL.)

# 2. Update both env vars in Vercel
vercel env rm UPSTASH_REDIS_REST_TOKEN production
vercel env add UPSTASH_REDIS_REST_TOKEN production
# paste new

# 3. Redeploy
vercel --prod

# 4. Verify: hammer /login locally with `for i in {1..15}; do curl -X POST …`
#    Should 429 after 10. Or watch the counter increment in Upstash → Data Browser.
```

If Upstash is unreachable for any reason, `getLoginRateLimit()` returns `null`
and the limiter becomes a no-op — login still works, but brute-force defense is
disabled until you fix the creds. This is intentional (availability over the
defense layer); confirm by tailing Vercel logs for the no-op log line.

### 1.5 Neon `DATABASE_URL`

Rotate by resetting the role password, not by recreating the project.

```bash
# 1. console.neon.tech → invoiced → Roles → Reset password for the prod role
# 2. Copy the new pooled connection string (must include `-pooler` host)
# 3. Update Vercel
vercel env rm DATABASE_URL production
vercel env add DATABASE_URL production
# paste new
# 4. Redeploy
vercel --prod
# 5. Verify: load the dashboard → server-rendered totals appear (DB reads work)
```

### 1.6 `ALLOWED_LOGIN_EMAILS`

CSV of authorized emails. Editing this is how you onboard/offboard a visitor
account. Removing an email does NOT delete that user's row — clean up via
SQL after to revoke the historical session JWTs and remove orphaned data.

```bash
vercel env rm ALLOWED_LOGIN_EMAILS production
vercel env add ALLOWED_LOGIN_EMAILS production
# paste new CSV
vercel --prod
```

---

## 2. Incident response — "I think something leaked"

Triage in this order. Do not skip steps even if the leak looks minor — it's
faster to over-rotate than to find out later that you missed an attack vector.

### 2.1 First 5 minutes — contain

1. **Block the suspected actor at the network edge** (only if you can identify
   the IP from `audit_log.ip_address`):
   ```sql
   -- Find recent suspicious actors
   SELECT ip_address, count(*) AS hits, max(occurred_at) AS last_seen
   FROM audit_log
   WHERE occurred_at > now() - interval '24 hours'
     AND actor_email LIKE 'rate-limited:%'
   GROUP BY ip_address ORDER BY hits DESC LIMIT 20;
   ```
   Add the IP to a temporary deny-list in `src/middleware.ts` if needed (no
   built-in deny-list yet — Phase 6 candidate).

2. **Force every active session to log out** by rotating `AUTH_SECRET`
   (§1.1). Takes ~30 seconds end-to-end.

### 2.2 First hour — rotate everything reachable from the leak

Pick the smallest scope that covers the leak. When in doubt, rotate all five.

| Suspected leak | Must rotate |
|---|---|
| Source-code / repo / IDE leak | `AUTH_SECRET`, `ADMIN_PASSWORD_HASH`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, both Upstash creds |
| Vercel account compromise | All five + change Vercel password + revoke all Vercel tokens |
| Neon account compromise | `DATABASE_URL`, then audit Neon project for unknown branches/roles |
| Upstash account compromise | Both Upstash creds, then check Upstash audit log for unknown IPs |
| Blob URL leak (single file) | Rotate `BLOB_READ_WRITE_TOKEN` and delete the specific blob via dashboard |
| `.env.local` leak from dev box | All five — local file mirrors prod values |

### 2.3 First day — investigate

Run the standard audit queries against prod Neon (read-only, safe):

```sql
-- 1. Anything created/modified/deleted in the leak window
SELECT occurred_at, actor_email, action, target, ip_address, user_agent
FROM audit_log
WHERE occurred_at BETWEEN '<leak-window-start>' AND '<leak-window-end>'
ORDER BY occurred_at DESC;

-- 2. Logins from unfamiliar IPs
SELECT date_trunc('hour', occurred_at) AS hour, ip_address, count(*)
FROM audit_log
WHERE action = 'login' AND occurred_at > now() - interval '7 days'
GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC;

-- 3. Document downloads (flag if there's a burst of them)
SELECT occurred_at, target, ip_address
FROM audit_log
WHERE action = 'download' AND occurred_at > now() - interval '7 days'
ORDER BY occurred_at DESC LIMIT 100;

-- 4. Rate-limit hits (sentinel actor_email = 'rate-limited:<ip>')
SELECT date_trunc('hour', occurred_at) AS hour, count(*) AS attempts
FROM audit_log
WHERE actor_email LIKE 'rate-limited:%'
  AND occurred_at > now() - interval '24 hours'
GROUP BY 1 ORDER BY 1 DESC;

-- 5. Verify metadata is still PII-clean post-incident
-- (run from the project root)
-- pnpm dlx dotenv-cli -e .env.production.local -- tsx scripts/verify-audit-metadata.ts
```

Cross-reference any `download` actions against Vercel Blob's access logs if
the dashboard exposes them (Storage → Blob → Activity).

### 2.4 First week — close out

- Document the timeline + root cause in this file under §6 "Incident log".
- Decide whether the leak warrants disclosure (visitor accounts, accountant).
- Schedule a follow-up rotation 30 days out as a tripwire — if the same key
  resurfaces in any monitoring, the leak source isn't closed.

---

## 3. Backup & restore drill — Neon

Neon's free tier retains the last 24h of WAL on the production branch and
supports point-in-time restore via branching. The procedure below is the
"oh no, I just deleted a year of invoices" runbook.

### 3.1 Pre-flight (do this BEFORE you need it)

The first time you read this, **practice the drill**:

```bash
# 1. Pick a known-safe timestamp 1 hour ago (current time minus 1h)
#    e.g., "2026-04-24T14:00:00Z"

# 2. In Neon dashboard: invoiced → Branches → "Create branch"
#    - Parent: production
#    - Restore point: pick the timestamp from step 1
#    - Name it: drill-2026-04-24

# 3. Copy the new branch's pooled connection string (it's a different host)

# 4. Spot-check it from the CLI
psql "<drill-branch-connection-string>" -c "SELECT count(*) FROM invoices;"
#    Should match what you had at that timestamp.

# 5. Delete the drill branch when done
#    Branches → drill-2026-04-24 → Delete
```

Drill practice was last completed on: **2026-04-24** (Phase 5-5 close).
Outcome: counts on stable tables (users, settings, all operational tables
post-wipe) matched prod-now exactly; `audit_log` had fewer rows on the drill
branch than on prod (5 vs 10), confirming PITR honors the timestamp instead
of cloning current state. Drill branch deleted immediately after.

### 3.2 Real restore — full prod rollback

When prod data is wrong and you need to revert to a known-good moment:

```bash
# 1. STOP the app first to prevent further writes:
#    Vercel dashboard → invoiced → Settings → General → "Pause Project"

# 2. Create a restore branch from the target timestamp (UI, as in 3.1)

# 3. Promote the restore branch to be the new production branch:
#    Neon dashboard → branches → drill-... → "Set as default"
#    OR keep production as-is and update DATABASE_URL to point to the new branch.
#    Setting the new branch as default is cleaner — the old one becomes a backup.

# 4. Verify by loading the dashboard locally:
vercel env pull .env.production.local --environment=production
pnpm dev   # or pnpm build && pnpm start

# 5. Resume the project on Vercel
```

### 3.3 Single-table surgery (preferred)

Full rollbacks lose intermediate good writes. For most bugs, restore one
table from a branch and `INSERT … SELECT` the missing rows back:

```bash
# 1. Create a read-only branch at the good timestamp (as in 3.1)

# 2. From your local psql:
#    psql "<production-url>" + dump-paste the missing rows from a query against
#    the restore branch. Or use Neon's SQL editor, which supports two-tab.

# 3. Re-run the affected reports to confirm.
```

### 3.4 Limits to know

- Neon free tier: 24h WAL retention. If the leak/bug is > 24h old you cannot
  PITR — only the last full snapshot is available (Neon retains them per plan;
  check the branches list for the oldest available `default` snapshot).
- Branches share storage with the parent — no extra cost for short-lived
  drill branches, but long-lived restore branches do count.

---

## 4. Phase 5 outcomes (shipped 2026-04-22 → 2026-04-24)

What landed:

| Phase | Commit(s) | What |
|---|---|---|
| 5-1 | (planning only) | Baseline scan + Vercel knowledge audit |
| 5-2a | `33eae70` | Headers: COOP/CORP/Origin-Agent-Cluster + tighter CSP (`object-src 'none'`, `frame-src 'self'`) |
| 5-2b | `9f0eed8` | drizzle-kit 0.30 → 0.31 (transitive vulns) |
| 5-2c | `e8e1306`, `1ec4374`, `d8a0d6a` | Next 15 → 16, React 19.2, next-auth beta.31, drop `"type": "module"` (Vercel CJS launcher fix) |
| 5-3a | `37377e6` | Upstash IP rate-limit on /login (10/10m sliding) |
| 5-3b | `c2c7a3a`, **`1f4ad3c` (revert)** | CSP nonce attempt — incompatible with Next.js prerender (static `/login` + `/settings` lose their script tags' nonce). **Deferred** until we have either app-wide dynamic rendering or Next ships nonce-aware prerender. |
| 5-3c | `5c1bf0e` | Vault-pin cookie `SameSite=lax` → `strict` |
| 5-3d | `259c777` | `verify-audit-metadata` PII-leak guard + `reset-vault-pin` typed-confirm |
| 5-4 | `d21601f`, `4320931` | `robots.txt`, drop unused 2 MB sprite, fix middleware matcher to allow crawler files |
| (ops) | `7ff0350` | `wipe-operational-data` script — 3-gate (`--apply` + typed confirm + masked URL display); used to wipe prod 2026-04-24 keeping visitor account |
| 5-5 | (this commit) | Vercel CLI install + env audit + `SECURITY_RUNBOOK.md` + Neon restore drill |

### 4.1 Lighthouse on prod `/login` (2026-04-24)

| Metric | Score |
|---|---|
| Performance | 87 |
| Accessibility | 100 |
| Best Practices | 100 |
| SEO | 66 (only `is-crawlable` failing — intentional `noindex`) |

### 4.2 Deferred / known gaps (carry into Phase 6)

- **CSP nonce + drop `'unsafe-inline'`** — see 5-3b above. Tracking issue:
  Next.js prerender + per-request nonce.
- **Middleware deny-list** — manual SQL is the only "block IP" tool today.
  Cheap to add: a small env-var deny-list in `src/middleware.ts` short-circuit
  before the auth handler.
- **Audit retention policy** — `audit_log` grows unbounded. Decide a window
  (12mo? 24mo?) and add a monthly trim cron once growth becomes meaningful.
- **Backup test cadence** — set a calendar reminder to re-run §3.1 every
  6 months so the SOP doesn't rot.

---

## 5. Tooling reference (cheat sheet)

```bash
# Env
vercel env ls production
vercel env pull .env.production.local --environment=production

# Deploy
vercel --prod
vercel logs <deployment-url>

# Local verifies
pnpm verify-all                  # type-check + lint + audit-metadata + others
pnpm dlx dotenv-cli -e .env.production.local -- tsx scripts/verify-audit-metadata.ts

# Rate-limit smoke test (against local dev with Upstash configured)
for i in $(seq 1 15); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/auth/callback/credentials \
    -d "email=foo@bar&password=wrong"
done

# Audit log: most-recent activity
psql "$DATABASE_URL" -c \
  "SELECT occurred_at, actor_email, action, target FROM audit_log ORDER BY occurred_at DESC LIMIT 30;"
```

---

## 6. Incident log

No incidents to date. Append new entries above the line below as `## 6.N` with:
date, suspected vector, scope, what was rotated, root cause, follow-ups.

---
