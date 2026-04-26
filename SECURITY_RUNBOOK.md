# Security Runbook — Invoiced

> Owner: Saïd Aïssani · Last reviewed: 2026-04-25
> Scope: production rotation SOPs, incident response, Neon backup/restore drill,
> and a record of what shipped in Phase 5 + 5B-blob + 5B-2FA + 5B-PWA.

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
| Mandatory 2FA | TOTP via `otplib`; AES-256-GCM ciphertext at rest under `TOTP_ENCRYPTION_KEY`; 5/15-min lockout shared with login; (app)/layout redirects unenrolled users to `/onboard/2fa` | `src/lib/totp.ts`, `auth.ts`, `src/app/(app)/layout.tsx` |
| Vault three-factor gate | session → PIN cookie → 2FA cookie. Both 60s sliding refresh on any authenticated action; auto-lock timer fires `router.refresh()` when TTL expires while staying on `/vault` | `src/lib/vault-pin-session.ts`, `src/lib/vault-2fa-session.ts`, `src/components/vault/vault-session-expiry.tsx` |
| Transport | HSTS preload, COOP/CORP same-origin, Origin-Agent-Cluster | `next.config.ts` |
| Content | CSP `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`, `script-src 'self' 'unsafe-inline'` (nonce attempt deferred — see § 4.2) | `next.config.ts` |
| Audit | `audit_log` (action + target + ip + UA + jsonb metadata) | `src/lib/db/schema.ts` |
| PII guard | `pnpm verify-audit-metadata` blocks forbidden keys in `audit_log.metadata` | `scripts/verify-audit-metadata.ts` |
| Storage | Vercel Blob `invoiced-blob-private` — Private mode, streamed via SDK `get()` through auth-gated proxy routes (no direct URL exposure) | `src/lib/blob.ts`, six `/api/.../route.ts` proxies |
| Optimistic lock | All 13 mutable tables have `updated_at` + version-check on UPDATE/DELETE; stale-tab edits surface a friendly refresh prompt | `src/lib/optimistic-lock.ts` |
| Crawlers | `public/robots.txt` Disallow + `<meta robots noindex>` | `src/app/layout.tsx` |

Production env vars (audit run 2026-04-25, all encrypted, prod-only):
`AUTH_SECRET`, `AUTH_URL`, `NEXTAUTH_URL`, `DATABASE_URL`,
`ADMIN_PASSWORD_HASH`, `ALLOWED_LOGIN_EMAILS`, `BLOB_READ_WRITE_TOKEN`
(Private-mode store), `TOTP_ENCRYPTION_KEY` (Sensitive),
`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (Sensitive),
`VAPID_SUBJECT`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`,
`CRON_SECRET` (Vercel-injected when `vercel.json` has crons).

`DATABASE_URL` is **deliberately not marked Sensitive** — see
`memory/feedback_database_url_not_sensitive.md`. All other secrets are
Sensitive so `vercel env pull` doesn't expose values.

Development scope mirrors prod for the non-data-bearing keys (VAPID,
TOTP_ENCRYPTION_KEY, AUTH_SECRET); DATABASE_URL points at the dev Neon
branch.

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

### 1.3 `BLOB_READ_WRITE_TOKEN` — Vercel Blob (Private mode)

The store is `invoiced-blob-private` (Private access). Reads happen via SDK
`get()` from server routes — no public URL fetch path. Rotating this token
invalidates only the SDK calls; existing blobs remain.

```bash
# 1. Vercel dashboard → Storage → invoiced-blob-private → Settings → Rotate token
#    (CLI rotation isn't supported as of 2026-04; UI only.)

# 2. The token in the project's env auto-syncs from the Storage panel.
#    Pull a fresh copy locally:
vercel env pull .env.production.local --environment=production

# 3. Redeploy to apply
vercel --prod

# 4. Verify: download an existing PDF + upload a new T4/T5 slip → both work.
#    The old token is invalidated immediately on the server side; no public
#    URLs exist for an attacker to reuse.
```

If you ever need to migrate to a fresh blob store entirely, see commit
`b318f0d` for the pattern (private store provisioning + `streamBlob()`
adapter + per-row blob re-upload). Private store access mode is fixed at
creation per Vercel — you cannot flip a public store to private.

### 1.4 `TOTP_ENCRYPTION_KEY` — 2FA secret encryption

The 2FA secret in `users.totpSecretEncrypted` is AES-256-GCM ciphertext under
this key. Rotating it invalidates every enrolled secret in the DB — every user
must re-enroll from `/settings → Security` after the rotation.

```bash
# 1. Generate a new 32-byte key
openssl rand -base64 32

# 2. BEFORE flipping the env: nuke every existing TOTP secret in prod DB so
#    users hit a clean re-enroll path on next login, not a "decrypt failed"
#    error from a mid-rotation mismatch.
#    Connect via Neon SQL Editor (production branch) and run:
#      UPDATE users SET totp_secret_encrypted = NULL,
#                       totp_backup_codes_hashed = NULL,
#                       totp_enabled_at = NULL,
#                       totp_failed_count = 0,
#                       totp_locked_until = NULL;
#    Repeat against the dev branch if dev users need the same reset.

# 3. Update Vercel (Production + Development scope, marked Sensitive)
vercel env rm TOTP_ENCRYPTION_KEY production
vercel env add TOTP_ENCRYPTION_KEY production
# paste the new value

# 4. Mirror locally
# edit .env.local → TOTP_ENCRYPTION_KEY=<new>

# 5. Redeploy
vercel --prod

# 6. Verify
#    - Try logging in. If you were enrolled, the post-password redirect will
#      still go to /login/2fa, but verifying any code returns null (secret is
#      gone). loginAction shows "Invalid code or session expired" — expected.
#    - Wipe the pending cookie: hit /login/cancel-2fa or just wait 60s.
#    - Re-enroll from /settings → Security → Enable 2FA.
```

Equivalent CLI escape (per-user, no SQL needed): `pnpm reset-2fa <email>`.

### 1.5 Upstash Redis REST URL + token

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

### 1.6 Neon `DATABASE_URL`

Rotate by resetting the role password, not by recreating the project.

```bash
# 1. console.neon.tech → invoiced → Roles → Reset password for the prod role
# 2. Copy the new pooled connection string (must include `-pooler` host)
# 3. Update Vercel
vercel env rm DATABASE_URL production
vercel env add DATABASE_URL production
# paste new — leave Sensitive flag UNCHECKED (see feedback_database_url_not_sensitive.md)
# 4. Redeploy
vercel --prod
# 5. Verify: load the dashboard → server-rendered totals appear (DB reads work)
```

### 1.7 VAPID keypair (Web Push)

The push notification keypair authenticates the server to Apple's APNs /
Google's FCM relays. Rotating invalidates every active push subscription;
all enrolled devices must re-subscribe via Settings → Notifications.

```bash
# 1. Generate a new keypair locally:
node -e "console.log(require('web-push').generateVAPIDKeys())"

# 2. Wipe existing subscriptions in prod DB (the old keys can no longer
#    sign for them; sending would 410 anyway):
#    Connect via Neon SQL Editor (production branch) and run:
#      TRUNCATE TABLE push_subscriptions;
#    (or DELETE WHERE endpoint LIKE ... if you want a partial rotation)

# 3. Update Vercel — both keys at once
vercel env rm NEXT_PUBLIC_VAPID_PUBLIC_KEY production
vercel env add NEXT_PUBLIC_VAPID_PUBLIC_KEY production
# paste new public key (NOT Sensitive — bundled into client JS)

vercel env rm VAPID_PRIVATE_KEY production
vercel env add VAPID_PRIVATE_KEY production
# paste new private key (Sensitive ✓)

# 4. Mirror locally
# edit .env.local → NEXT_PUBLIC_VAPID_PUBLIC_KEY=<new>, VAPID_PRIVATE_KEY=<new>

# 5. Redeploy
vercel --prod

# 6. Verify: open the installed PWA → Settings → Security → Notifications →
#    Re-enable on the device. The "Registered devices" list should update.
```

`VAPID_SUBJECT` is a contact mailto: only — no rotation needed unless the
contact email changes.

### 1.8 `ALLOWED_LOGIN_EMAILS`

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

Pick the smallest scope that covers the leak. When in doubt, rotate all eight.

| Suspected leak | Must rotate |
|---|---|
| Source-code / repo / IDE leak | `AUTH_SECRET`, `ADMIN_PASSWORD_HASH`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `TOTP_ENCRYPTION_KEY`, `VAPID_PRIVATE_KEY`, both Upstash creds |
| Vercel account compromise | All eight + change Vercel password + revoke all Vercel tokens |
| Neon account compromise | `DATABASE_URL`, then audit Neon project for unknown branches/roles |
| Upstash account compromise | Both Upstash creds, then check Upstash audit log for unknown IPs |
| Blob token leak | Rotate `BLOB_READ_WRITE_TOKEN` (UI-only); existing private blobs are unreachable without the new token |
| 2FA secret column dump | Rotate `TOTP_ENCRYPTION_KEY` (§ 1.4) — the leaked ciphertext can't be decrypted without it |
| `.env.local` leak from dev box | All eight — local file mirrors prod values |
| Push subscription leak | Rotate `VAPID_PRIVATE_KEY` (§ 1.7) — leaked subs can no longer be signed for |

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

## 4. Shipped security work

### 4.0 Phase 5 (2026-04-22 → 2026-04-24)

| Phase | Commit(s) | What |
|---|---|---|
| 5-1 | (planning only) | Baseline scan + Vercel knowledge audit |
| 5-2a | `33eae70` | Headers: COOP/CORP/Origin-Agent-Cluster + tighter CSP (`object-src 'none'`, `frame-src 'self'`) |
| 5-2b | `9f0eed8` | drizzle-kit 0.30 → 0.31 (transitive vulns) |
| 5-2c | `e8e1306`, `1ec4374`, `d8a0d6a` | Next 15 → 16, React 19.2, next-auth beta.31, drop `"type": "module"` (Vercel CJS launcher fix) |
| 5-3a | `37377e6` | Upstash IP rate-limit on /login (10/10m sliding) |
| 5-3b | `c2c7a3a`, **`1f4ad3c` (revert)** | CSP nonce attempt — incompatible with Next.js prerender. **Won't fix** in current architecture; revisit only if Next ships nonce-aware prerender or we move to app-wide dynamic rendering. |
| 5-3c | `5c1bf0e` | Vault-pin cookie `SameSite=lax` → `strict` |
| 5-3d | `259c777` | `verify-audit-metadata` PII-leak guard + `reset-vault-pin` typed-confirm |
| 5-4 | `d21601f`, `4320931` | `robots.txt`, drop unused 2 MB sprite, fix middleware matcher to allow crawler files |
| (ops) | `7ff0350` | `wipe-operational-data` script — 3-gate (`--apply` + typed confirm + masked URL display); used to wipe prod 2026-04-24 keeping visitor account |
| 5-5 | `16e73d6` | Vercel CLI install + env audit + this runbook + Neon restore drill |

### 4.1 Phase 5B-blob — Private Vercel Blob migration (2026-04-25)

| Commit | What |
|---|---|
| `b318f0d` | Provisioned `invoiced-blob-private` (Private mode), retired the old public `invoiced-blob` store. New `src/lib/blob.ts` adapter with `streamBlob()` helper that wraps SDK `get()` with the per-route streaming shape. Flipped all 11 `put()` callsites to `access: "private"`; converted all 6 `/api` proxy routes to use `streamBlob()` instead of plain `fetch(blobUrl)`. Direct blob URL is now unreachable to the browser without the read-write token. The old store was deleted intentionally during migration; pre-migration PDFs are not recoverable (DB phantoms swept by `cleanup-phantom-docs --apply`). Per Vercel: store access mode is fixed at creation, so any future re-org needs a fresh store + re-upload pass. |

### 4.2 Phase 5B-2FA — Mandatory TOTP 2FA (2026-04-25)

| Commit | What |
|---|---|
| `b1e1acb` (PR1) | Schema columns on `users`: `totp_secret_encrypted`, `totp_enabled_at`, `totp_backup_codes_hashed`, `totp_failed_count`, `totp_locked_until`. Pure module `src/lib/totp.ts` — AES-256-GCM with explicit-key parameter, otplib v13 functional API (verifySync, ±30s drift), backup codes argon2id-hashed and consumed once. Pending-cookie scheme `__Host-2fa-pending` (60s, HMAC-signed under `AUTH_SECRET`). Updated `auth.ts` authorize() to dispatch by `mode` — default email/password, `2fa` mode reads pending cookie and verifies TOTP, `2fa-backup` consumes a backup code. 4-step enrollment wizard + status card on Settings → Security. `/login/2fa` page hard-gated by the pending cookie. CLI escape hatch `pnpm reset-2fa <email>`. 7-check `verify-totp` script. |
| `801d4e9` (PR2) | Vault three-factor stack — session → PIN cookie → 2FA cookie. New `__Host-vault-2fa` cookie (60s) and `requireVault2faSession()` gate enforced on `/vault` page + `/api/documents/[id]` route. Shared lockout state with login 2FA via the same `totpFailedCount`/`totpLockedUntil` columns. |
| `d730fac` (PR3) | Animated oklch mesh-gradient login backdrop (cosmetic — `/login`, `/login/2fa`). |
| `e7c4456` (PR4) | This runbook + README + memory polish. |
| `4daffb6` | Mandatory 2FA enforcement — (app)/layout redirects unenrolled users to `/onboard/2fa` until they finish the wizard. Login action shortcuts non-enrolled users straight there to avoid the dashboard-bounce. |
| `d70b7aa` | Sliding refresh on vault cookies — every successful action re-issues both cookies, so active use never silently times out. Closed a gap where the vault server actions only enforced PIN, not 2FA. |
| `c115cd0` | Auto-lock when TTL expires while the user stays on `/vault` — client timer fires `router.refresh()` exactly at cookie expiry. |
| `dc096c3` | Inline unlock dialog when opening contract attachments from `/clients` so users don't have to detour through `/vault`. |

### 4.3 Optimistic-locking sweep (2026-04-25)

| Commit | What |
|---|---|
| `23df825`, `25ec8ca`, `ac0974f`, `db3f28c`, `cef7fb9` | Version-check on UPDATE/DELETE for all 13 mutable tables. Stale-tab edits surface as `{ error: "stale" }` action results that forms catch + auto-refresh. Closed the only remaining open P2 finding from the silent-history-rewrite audit. |

### 4.4 Phase 5B-PWA — Installable as iPhone/iPad app (2026-04-25)

| Commit | What |
|---|---|
| `02d16da` (PR1) | `manifest.json` + 4 icon sizes + 5 iOS splash screens + apple-touch-icon, all generated by `pnpm gen-pwa-assets` from `public/logo.png` and baked onto the brand-dark background. Layout metadata: manifest link, apple-mobile-web-app capable + black-translucent status bar + per-device startupImage matrix. (app)/layout adds `pt-[env(safe-area-inset-top)]` so the TopBar doesn't render under the notch. |
| `da2bdee` (PR2) | Serwist service worker — precaches `/_next/static/*` for instant cold launches. Excludes `/api`, `/login`, `/vault` routes (cache-control no-store enforced server-side too). Build switched to `next build --webpack` because Serwist's webpack-config injection conflicts with Turbopack default. |
| `e5d37a4` (PR3) | Web Push for upcoming deadlines — daily Vercel Cron at 12:00 UTC. New `push_subscriptions` table; subscribe/unsubscribe via Settings → Security toggle; SW push handler renders system notification → opens `/calendar` on tap. CRON_SECRET-gated route. New env: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (Sensitive), `VAPID_SUBJECT`. |
| `c46a07c` | Mobile hamburger drawer (the desktop sidebar was `hidden md:flex` with no mobile alternative). |
| `41c5c3b` | PWA icons re-baked on dark background so the white-text logo stays readable on iOS home screen. |

### 4.5 Lighthouse on prod `/login` (2026-04-24)

| Metric | Score |
|---|---|
| Performance | 87 |
| Accessibility | 100 |
| Best Practices | 100 |
| SEO | 66 (only `is-crawlable` failing — intentional `noindex`) |

> **Note:** scores from before the cosmic aurora background + starfield landed
> (commits `33198c8`, `0581ada`). Re-run on demand — the multi-layer composition
> may shift Performance a few points.

### 4.6 Deferred / known gaps

- **CSP nonce + drop `'unsafe-inline'`** — won't fix in the current architecture
  (Next.js prerender carries no per-request nonce; revisit if Next ships
  nonce-aware prerender or the app moves to fully dynamic rendering).
- **Middleware deny-list** — manual SQL is the only "block IP" tool today.
  Cheap to add: a small env-var deny-list in `src/middleware.ts` short-circuit
  before the auth handler.
- **Audit retention policy** — `audit_log` grows unbounded. Decide a window
  (12mo? 24mo?) and add a monthly trim cron once growth becomes meaningful.
- **Backup test cadence** — set a calendar reminder to re-run §3.1 every
  6 months so the SOP doesn't rot.
- **GitHub branch protection + secret scanning** — gated behind GitHub Pro /
  GHAS for private repos. Locally we run a leak + vuln scan before every
  commit (`feedback_commit_security_audit.md`); revisit if the repo gains
  more contributors. See `feedback_github_security_posture.md`.

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
