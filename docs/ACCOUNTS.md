# WalkMyCode accounts — FINAL spec (`docs/ACCOUNTS.md`)

Email-code registration, database sessions, GitHub sign-in, for the **hosted** full app (`WALKMYCODE_MODE=hosted`). BYOK self-host has no accounts; Lite uses the viewer's Claude identity. Both are untouched except for one `gate()` helper that knows which mode it is in, and the same-origin guard that `/api/claude` gains in every mode. All paths are under `codebase-guide\`. iReliabee was read only.

## 0. What changed since the reviewed draft

| Review finding | Fix in this spec |
|---|---|
| Anyone who knows an address can lock its owner out (supersede or burn codes) because `/verify` was keyed by email alone | **Requester binding**: `/request` sets a `walkmycode_signin` cookie; the row stores `requester_hash`; `/verify` looks up by `(email, requester_hash)` across **all** live rows; attempt increment is atomic and happens **before** the compare (§1 B1) |
| "Open the link on any device — this tab will notice" was false | Copy rewritten: the link signs in **the device it is opened on**; the original tab polls `/me` and says so only when the link was spent from the same browser (§1 B2, §8) |
| 30-bit code hashed with plain SHA-256: a DB read = a live sign-in | `code_hash = HMAC-SHA256(k_code, email + ":" + code)`, `k_code` derived by HKDF from `WALKMYCODE_AUTH_SECRET`; every use of the secret gets its own HKDF sub-key (§2) |
| In-memory rate limits; XFF rule unspecified | `throttle` table in SQLite; last XFF hop only when `WALKMYCODE_TRUSTED_PROXY=1`; `/me` and the link GET are never counted (§3) |
| Hard delete impossible under FK + retention | Anonymise-and-revoke deletion; FKs carry `ON DELETE` rules anyway (§4, §5) |
| `next` open-redirect under-specified | Exact validator; GitHub `next` travels inside the signed state cookie; `/signin?error=` is an enum (§1 B2, §1 C) |
| Secure/`__Host-` decided from `Host` (wrong behind TLS proxy) | Decided from `SITE_URL` scheme; state and requester cookies get the same treatment (§2) |
| Same-origin guard compared against `Host`; `/api/claude` unguarded | Guard compares `Origin` against `SITE_URL` origin (Host fallback in byok), refuses a POST with neither `Sec-Fetch-Site` nor `Origin`; applied to `/api/claude` in every mode (§6) |
| Stale-cookie fixation edge; refresh-token reuse | Sign-in always revokes any session the browser already holds and mints a fresh token; refresh tokens (later) get a `family` column with reuse detection (§1 D, §2) |
| Privacy text promised "no IP addresses" | Honest wording: hashed short-lived counter; host and Resend keep logs; Resend stores sent bodies (§9) |
| Pruning on the `/request` hot path | `setInterval` registered once on `globalThis` from `instrumentation.ts` (§5) |
| Link-pressing scanners | POST `/api/auth/link` requires `Sec-Fetch-Mode: navigate` + `Sec-Fetch-User: ?1` when Sec-Fetch headers are present; counter for links spent < 5 s after their GET (§1 B2) |

Kept: no password ever; account row created on first successful sign-in; one `sign_ins` row carrying code + link; conditional `UPDATE … WHERE used_at IS NULL` + `rowsAffected` on both paths; GET renders / POST spends with `referrer: same-origin`; no membership oracle anywhere; opaque revocable DB sessions (30 d sliding / 180 d absolute); Bearer tokens deferred; GitHub keyed by numeric id, verified primary email only, no OAuth token stored; migrations written once in final shape; libsql over a WAL file with Turso as the escape hatch; `ADMIN_EMAILS` read per request; `WALKMYCODE_DEV_CODES` ignored in production; plain beginner copy.

## 1. Flow, step by step

### A. Request a code — `POST /api/auth/request`

Body `{ email }` (JSON) from `SignIn.tsx`.

1. `assertSameOrigin(req)` (§6). Failure → 403 `{error: friendly("forbidden")}`.
2. `mode() === "byok"` → 404 `{error: "Accounts are off in self-hosted mode."}` (every `/api/auth/*` route does this first).
3. `normaliseEmail` (trim, NFC, lowercase); `looksLikeEmail` = `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/` and length ≤ 254 → else 400 `{error: "That email address does not look right."}`.
4. Throttle (§3): `hit("req-ip:" + ipKey(req), 10, 600)` false → 429 `{error: "That is a lot of sign-in requests. Wait a few minutes and try again."}`. Per-email cooldown: newest `sign_ins` row for the email with `created_at > now-60` → skip to step 8 **without** minting or sending (same body, same status, same timing class — the handler still does one hash to keep timing flat).
5. Requester cookie: if the request carries a valid `walkmycode_signin` cookie (43-char base64url), reuse it; otherwise mint `requester = secret()` and set the cookie (`HttpOnly; SameSite=Lax; Path=/; Max-Age=600; Secure` when SITE_URL is https, then named `__Host-walkmycode_signin`). `requester_hash = sha256(requester)`.
6. Mint: `code = authCode(6)` (Crockford base32 without I/L/O/U, 30 bits), `link = secret()` (32 random bytes, base64url). Insert:
   `sign_ins(id="si_"+secret(12), email, code_hash=codeHash(email, code), link_hash=sha256(link), requester_hash, attempts=0, expires_at=now+600, created_at=now)`.
7. Mail via `sendMail` (§7). Returns `false` (nothing configured): if `mayLogCodes()` → log `auth: DEV code for <email>: ABC-DEF  link: <SITE_URL>/signin/link?token=…` and continue; else → 503 `{error: "Sign-in by email isn't available right now. Please try again later."}` (row is left in place; it expires). Throws (Resend refused) → 502 `{error: "Could not send the email just now. Please try again in a moment."}`.
8. **Always** 200 `{ok: true, message: "Check your email for a code and a link."}` for a syntactically valid address, whether or not an account exists and whether or not the cooldown swallowed the send.

### B1. Typed code — `POST /api/auth/verify`

Body `{ email, code }`.

1. `assertSameOrigin`; byok → 404; `hit("verify-ip:" + ipKey, 20, 600)` → 429 (same text as A).
2. Read the `walkmycode_signin` cookie. Missing or malformed → the **same 401** as step 6 (no distinct message). `requester_hash = sha256(cookie)`.
3. `normaliseAuthCode` (uppercase; strip `\s . - _`; `I`,`L`→`1`; `O`→`0`). Length ≠ 6 → same 401.
4. Candidates: `SELECT id, code_hash FROM sign_ins WHERE email=? AND requester_hash=? AND used_at IS NULL AND expires_at>? AND attempts<5 ORDER BY created_at DESC` (a browser that asked twice has two live rows; either code works).
5. For each candidate, **first** `UPDATE sign_ins SET attempts=attempts+1 WHERE id=? AND attempts<5 AND used_at IS NULL`; `rowsAffected !== 1` → skip. Then `sameSecret(code_hash, codeHash(email, code))` (constant time). Match → step 6. No match on any row → 401 `{error: {code: "bad_code", message: "That code did not work. Check the email again, or ask for a new one."}}`. Concurrent guesses cannot exceed 5 per row because the increment is the guard, not a read.
6. Spend atomically: `UPDATE sign_ins SET used_at=? WHERE id=? AND used_at IS NULL`; `rowsAffected !== 1` → same 401.
7. `upsertAccount(email)` — **the registration point** — then `startSession(account, req)` (§1 D: revokes any session already in the cookie, mints a fresh token), clear `walkmycode_signin`, 200 `{ok: true, account: {id, email, display_name, role}}` + `Set-Cookie`.

Because the row is found by `(email, requester_hash)`, a code can never sign someone into another account, and nobody without the requester cookie can burn, supersede or guess it.

### B2. Link — `GET /signin/link?token=…` (page) and `POST /api/auth/link`

**GET** is an App Router server component with `export const dynamic = "force-dynamic"` (no-store) and `metadata = { referrer: "same-origin", robots: { index: false, follow: false } }`. It calls `lookupLink(token)` which is **read-only** (`SELECT email, expires_at, used_at FROM sign_ins WHERE link_hash=?`). Live → board "Sign in to WalkMyCode" / "Finish signing in as **{email}** on this device." with `<form method="post" action="/api/auth/link">` holding hidden `token` and (if present and valid) `next`, button **Sign in**. Anything else → "This link has expired" page (§8). The GET also records `link_viewed_at = COALESCE(link_viewed_at, now)` — the one write, harmless, used for the scanner counter.

**POST** `/api/auth/link` (`application/x-www-form-urlencoded`, fields `token`, `next?`):

1. `assertSameOrigin`; byok → 404; `hit("link-ip:" + ipKey, 20, 600)` → 429.
2. Scanner gate: if the request has any `Sec-Fetch-*` header, require `Sec-Fetch-Mode: navigate` and `Sec-Fetch-User: ?1` (a real button press); otherwise refuse with the expired page. Sandboxed detonators that post forms without user activation fail here; humans never notice.
3. `spendLink(token)`: `UPDATE sign_ins SET used_at=? WHERE link_hash=? AND used_at IS NULL AND expires_at>? RETURNING email, requester_hash, link_viewed_at`; no row → 303 `/signin/link?state=expired` (rendered from the enum, not from the token).
4. If `now - link_viewed_at < 5` increment the process counter `auth.link_fast_spend` and log `auth: link spent <5s after view` (no identifiers) so scanner activity is visible.
5. `upsertAccount(email)`, `startSession`, clear `walkmycode_signin`. Response 303 → `safeNext(next) ?? "/map?signed_in=1"`.
6. Same-browser detection: if the POST carries a `walkmycode_signin` cookie whose hash equals the row's `requester_hash`, the redirect target gets `&same=1`; the original tab, which polls `GET /api/auth/me` every 2 s while State 2 is showing, sees `account` non-null and finishes. On a different device the phone signs in and the laptop tab keeps showing State 2 with honest copy (§8).

`safeNext(s)`: accept only when `typeof s === "string"`, `s.length <= 512`, `/^\/(?![\/\\])[^\r\n]*$/.test(s)`, no `:` before the first `/` after position 0, and `new URL(s, SITE_URL).origin === new URL(SITE_URL).origin`; return the resolved `pathname + search + hash`, else `null`.

### C. GitHub — `GET /api/auth/github` and `GET /api/auth/github/callback`

**Start**: byok → 404; `GITHUB_CLIENT_ID` unset → 303 `/signin?error=github_off`. Build `state = secret(16)`; cookie `walkmycode_oauth` (`__Host-` when https; HttpOnly; Lax; Max-Age=600) whose value is `b64url(JSON{state, next: safeNext(query.next), iat}) + "." + b64url(HMAC-SHA256(k_state, payload))`. 302 to `https://github.com/login/oauth/authorize?client_id&scope=read:user%20user:email&state=<state>&redirect_uri=<SITE_URL>/api/auth/github/callback`.

**Callback** `?code&state`: verify the cookie signature (constant time), `iat` within 600 s, `state` equals the cookie's (constant time) → else 303 `/signin?error=github_state`. Exchange at `https://github.com/login/oauth/access_token` (`Accept: application/json`, 15 s `AbortSignal.timeout`) → `GET https://api.github.com/user` and `/user/emails` (`Authorization: Bearer`, `User-Agent: WalkMyCode`). Take the email with `primary && verified`; none → 303 `/signin?error=github_email`. Identity resolution: `SELECT account_id FROM identities WHERE provider='github' AND provider_id=?`; found → that account (the GitHub id wins over a changed address; if the GitHub email now belongs to a *different* existing account, do not merge — sign in to the identity's account); not found → `upsertAccount(email, {display_name: gh.name ?? gh.login})` then `INSERT OR IGNORE identities`. `startSession` → 303 `next ?? "/map?signed_in=1"`. Any fetch failure → `/signin?error=github_down`. **The access token is discarded**; when the repo connector needs one it lives in its own `github_grants` table encrypted with `k_github` (HKDF), never in `accounts`.

Error enum rendered by `SignIn.tsx` (query value is looked up in a table; unknown values show nothing):

| `error=` | Shown on the board |
|---|---|
| `github_off` | "GitHub sign-in isn't set up on this server. Use a code instead." |
| `github_state` | "That GitHub sign-in took too long or was opened in another browser. Try again." |
| `github_email` | "Your GitHub account has no verified email address. Add one on GitHub, or sign in with a code instead." |
| `github_down` | "GitHub didn't answer. Try again in a moment, or sign in with a code." |

### D. Every later request — `gate(req, { require? })` in `src/lib/auth/gate.ts`

Returns `{ mode, account: Account | null }`. In byok mode returns `{mode: "byok", account: null}` immediately and never throws. In hosted mode: read the session cookie (or `Authorization: Bearer` once §2 "later" tokens exist) → `SELECT s.token_hash, s.created_at, s.last_used, a.* FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?`.
- `a.status='blocked'` → throw `GateError(403, friendly("suspended"))`: title "This account can't use the AI right now", message "It has been suspended. Email support@<domain> and we'll sort it out." (never a sign-in loop).
- `a.status='deleted'` or no row → treated as signed out.
- Sliding renewal: `now - last_used > 3600` → `UPDATE sessions SET last_used=?, expires_at=MIN(?+2592000, created_at+15552000) WHERE token_hash=?`; also `UPDATE accounts SET last_seen=?`.
- `require` and no account → throw `GateError(401, friendly("sign_in"))`: `{code: "sign_in", title: "Sign in to ask the guide", message: "The map is yours to explore. Asking, explaining and tours need an account, so we can keep track of credits.", action: "sign_in"}`.
- `role` is `a.role`, or `"admin"` when the email is in `ADMIN_EMAILS` (read from env on each call; nothing cached in the DB).

**Session hygiene**: `startSession` first reads any existing session cookie and revokes that row (whoever it belonged to), then mints a fresh 32-byte token — a browser can never keep a token it held before sign-in.

What is gated: Explain / Ask / Tour (`/api/claude`, later `/api/ai`), the voice lecturer relay, saved workspaces. Free and anonymous: connect, map, code view, trace, Files (they run in the browser).

### E. Sign-out

`POST /api/auth/signout` → `UPDATE sessions SET revoked_at=? WHERE token_hash=?`, clear cookie, `{ok: true}` always. `POST /api/auth/signout-all` → requires a live session; revokes every session of that account; `{ok: true}`. Toasts: "Signed out on this browser." / "Signed out everywhere."

### F. Delete — `POST /api/auth/delete` `{ confirm: email }`

Requires a live session and `confirm === account.email`. `deleteAccount(id)` (§4) then clear the cookie, `{ok: true}`. Toast: "Your account is gone. Thanks for trying WalkMyCode."

## 2. Secrets, keys, formats, lifetimes

**Key derivation** (`src/lib/auth/keys.ts`): `WALKMYCODE_AUTH_SECRET` (≥ 32 bytes, base64) is never used raw. `subkey(info)` = `crypto.hkdfSync("sha256", secret, "walkmycode-v1", info, 32)`, memoised per process:

| Sub-key | `info` | Used for |
|---|---|---|
| `k_code` | `signin-code` | `codeHash(email, code) = hex(HMAC-SHA256(k_code, email + ":" + code))` |
| `k_ip` | `ip-hash` | throttle keys `hex(HMAC(k_ip, ip))` |
| `k_state` | `oauth-state` | signing the GitHub state cookie payload |
| `k_token` | `access-token` | later: access-token HMAC |
| `k_github` | `github-grants` | later: AES-256-GCM for stored repo grants |

Hosted boot refuses to start (throws from `instrumentation.ts`) when `WALKMYCODE_AUTH_SECRET` decodes to fewer than 32 bytes or `SITE_URL` is unset.

| Secret | Format | Life | At rest |
|---|---|---|---|
| Sign-in code | 6 × `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (30 bits), shown `ABC-DEF` | 10 min, single use, 5 attempts | `sign_ins.code_hash` HMAC (peppered, email-bound) |
| Requester cookie `walkmycode_signin` | base64url 32 bytes | 10 min | `sign_ins.requester_hash` SHA-256 |
| Magic link token | base64url 32 bytes (43 chars) | 10 min, single use | `sign_ins.link_hash` SHA-256 |
| Session token, cookie `walkmycode_session` | base64url 32 bytes | 30 d sliding, 180 d absolute, revocable | `sessions.token_hash` SHA-256 |
| OAuth state cookie `walkmycode_oauth` | signed `{state, next, iat}` | 10 min | not stored |
| Account id | `acc_` + `secret(12)` | — | `accounts.id` |
| Later: refresh token | base64url 32 bytes | 90 d, rotated each refresh, `family` reuse detection | `refresh_tokens.token_hash` |
| Later: access token | `LNA1.<b64url JSON {v,sub,dev,iat,exp}>.<b64url HMAC(k_token)>` — **no email** in the payload | 15 min | never stored |

**Cookie attributes**: `HttpOnly; Path=/; SameSite=Lax`. `Secure` and the `__Host-` prefix are applied iff `new URL(SITE_URL).protocol === "https:"` — never derived from `Host` or the request scheme, so a TLS-terminating proxy cannot make the cookie ship insecure. All three cookies (`session`, `signin`, `oauth`) follow the same rule. Lax, not Strict: the link POST and the GitHub callback arrive as top-level navigations and must land signed in; CSRF is covered by the same-origin guard on every state-changing route. `__Host-` pins `Path=/` and forbids `Domain`, so a subdomain cannot plant a session.

## 3. Abuse guards

- **Throttle** (`src/lib/auth/throttle.ts`): fixed 10-minute buckets in the `throttle` table: `INSERT INTO throttle(key, window_start, count) VALUES(?,?,1) ON CONFLICT(key, window_start) DO UPDATE SET count=count+1 RETURNING count`; `hit(key, limit, windowSec)` returns `count <= limit`. Survives restarts and cluster workers. Limits: `/request` 10 per IP, `/verify` 20 per IP, `/link` POST 20 per IP, `/github/callback` 20 per IP, `/delete` 5 per IP. **Never counted**: `/api/auth/me`, the `/signin/link` GET, `/signout`.
- **Client IP** (`ipKey(req)`): with `WALKMYCODE_TRUSTED_PROXY=1`, the **last** entry of `x-forwarded-for` (the hop your own proxy appended); otherwise `x-forwarded-for` is ignored and the socket address is used (Next exposes it via the `x-real-ip`-free path: we read `req.headers.get("x-forwarded-for")` only when trusted, else fall back to `"local"`, which in practice means byok/dev where the limiter is moot). The key stored is `hex(HMAC(k_ip, ip))`; no IP is ever written.
- **Per-email cooldown** 60 s (silent), **5 attempts per code row**, rows found only by `(email, requester_hash)`.
- **No membership oracle**: identical `/request` answer and timing class; one failure text for wrong/expired/used/unknown/missing-cookie codes; one expired page for links; GitHub errors say nothing about existing accounts.
- **Constant-time compares** (`crypto.timingSafeEqual` on equal-length buffers) for code, link, session, state.
- **Scanner safety**: GET renders, POST spends; POST requires user-activated navigation when Sec-Fetch headers exist; `link_fast_spend` counter.
- **Logging**: never `Authorization`, `Cookie`, `/api/auth/*` bodies, or the code. The only auth lines are counts and the `DEV code` line, which is emitted only when `WALKMYCODE_DEV_CODES=1 && NODE_ENV !== "production"`.
- **Pruning** (`src/lib/db/housekeeping.ts`, registered once from `instrumentation.ts` under `globalThis.__walkmycodePrune`): every 10 min `DELETE FROM sign_ins WHERE expires_at < now-86400`; `DELETE FROM sessions WHERE expires_at < now-2592000 OR (revoked_at IS NOT NULL AND revoked_at < now-2592000)`; `DELETE FROM throttle WHERE window_start < now-1800`. Nothing runs on the request path.

## 4. What an account stores — and must not

Stores: `email`, `display_name` (GitHub only — we never ask for a name), `status`, `blocked_at`, `blocked_reason` (private), `role`, `created_at`, `last_seen`, `deleted_at`; `sessions.label` ("Chrome on Windows", parsed from the UA, raw UA discarded); `identities`; later `ledger`/`holds`/`usage_events` (time, kind, provider, model, tokens, cost — never content) and `checkouts`.

Must not store: codes, links, session or requester tokens in the clear; provider keys (hosted uses the server env; BYOK keys live in `.walkmycode/keys.env` with no accounts); GitHub OAuth tokens (this phase); code, maps, questions, answers; IP addresses (only the HMAC'd counter key, ≤ 30 min); passwords (none exist).

**Deletion** (`deleteAccount(id)`, one `transaction("write")`): `UPDATE accounts SET email='deleted:'||id, display_name='', status='deleted', deleted_at=now WHERE id=?`; `UPDATE sessions SET revoked_at=now WHERE account_id=? AND revoked_at IS NULL`; `DELETE FROM identities WHERE account_id=?`; `DELETE FROM sign_ins WHERE email=<old email>`; write `admin_actions(action='delete')` with `admin_id = account id` when self-service. Ledger, checkouts and usage rows stay for their retention period (§9), pointing at an anonymised row. A later sign-in with the same email creates a fresh account.

## 5. Tables — `src/lib/db/migrations/0001_accounts.sql`

```sql
-- Applied once, in order, by src/lib/db/index.ts; recorded in schema_migrations.
-- Every file is written in its final shape; no bare ALTER after the fact.
CREATE TABLE IF NOT EXISTS schema_migrations (
  name        TEXT PRIMARY KEY,
  applied_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id             TEXT PRIMARY KEY,                    -- acc_<random>
  email          TEXT NOT NULL UNIQUE,                -- lower-cased identity; 'deleted:<id>' after deletion
  display_name   TEXT NOT NULL DEFAULT '',            -- from GitHub only; never asked for
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','blocked','deleted')),
  blocked_at     INTEGER,
  blocked_reason TEXT NOT NULL DEFAULT '',            -- private, backoffice only
  role           TEXT NOT NULL DEFAULT 'user'
                 CHECK (role IN ('user','admin')),    -- set by owners; ADMIN_EMAILS is read from env, never cached here
  created_at     INTEGER NOT NULL,
  last_seen      INTEGER,
  deleted_at     INTEGER
);

-- One sign-in attempt: carries the typed code, the emailed link and the browser that asked.
CREATE TABLE IF NOT EXISTS sign_ins (
  id              TEXT PRIMARY KEY,                   -- si_<random>
  email           TEXT NOT NULL,
  code_hash       TEXT NOT NULL,                      -- HMAC-SHA256(k_code, email ':' code); peppered, email-bound
  link_hash       TEXT NOT NULL UNIQUE,               -- sha256 of the 32-byte link token
  requester_hash  TEXT NOT NULL,                      -- sha256 of the walkmycode_signin cookie; the code only works from that browser
  attempts        INTEGER NOT NULL DEFAULT 0,         -- incremented BEFORE compare; 5 kills the row
  expires_at      INTEGER NOT NULL,                   -- created_at + 600
  used_at         INTEGER,                            -- single use; set by the conditional UPDATE
  link_viewed_at  INTEGER,                            -- first GET of the link page; scanner telemetry only
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sign_ins_email ON sign_ins (email, requester_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_sign_ins_expiry ON sign_ins (expires_at);

-- One row per signed-in browser. The cookie holds the token; we hold its hash.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label       TEXT NOT NULL DEFAULT '',               -- "Chrome on Windows"; no raw user agent
  created_at  INTEGER NOT NULL,
  last_used   INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,                       -- sliding 30 d, capped at created_at + 180 d
  revoked_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions (account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (expires_at);

-- External identities (GitHub now). No provider tokens here.
CREATE TABLE IF NOT EXISTS identities (
  provider     TEXT NOT NULL,                         -- 'github'
  provider_id  TEXT NOT NULL,                         -- GitHub numeric id as text
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_id)
);
CREATE INDEX IF NOT EXISTS idx_identities_account ON identities (account_id);

-- Fixed-window rate-limit buckets. key = HMAC(k_ip, ip) prefixed by route; pruned after 30 min.
CREATE TABLE IF NOT EXISTS throttle (
  key           TEXT NOT NULL,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_throttle_window ON throttle (window_start);

-- Append-only audit of what was done to accounts (block / unblock / promote / demote / delete).
CREATE TABLE IF NOT EXISTS admin_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id  TEXT NOT NULL UNIQUE,                   -- idempotency
  admin_id    TEXT NOT NULL,                          -- an account id; the account itself for self-service delete
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  action      TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  at          INTEGER NOT NULL
);
```

Later, unchanged in intent: `0002_tokens.sql` — `refresh_tokens(token_hash PK, account_id REFERENCES accounts(id) ON DELETE CASCADE, family TEXT NOT NULL, device, label, created_at, last_used, expires_at, revoked_at, replaced_by)`; presenting a token whose `replaced_by` is set revokes every row with the same `family`. `0003_credits.sql` — iReliabee's `ledger`, `holds`, `usage_events`, `free_devices`, `checkouts` with `account_id REFERENCES accounts(id) ON DELETE RESTRICT`, the partial unique index `idx_ledger_ref ON ledger (account_id, ref) WHERE ref != ''`, and the conditional-INSERT `openHold`; balance stays derived.

`src/lib/db/index.ts` (`import "server-only"`): `db()` returns one `createClient({url: WALKMYCODE_DB_URL ?? "file:.walkmycode/walkmycode.db", authToken: WALKMYCODE_DB_AUTH_TOKEN})` per process (memoised on `globalThis` so `next dev` re-evaluation does not leak clients); for `file:` URLs runs `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000`; then `migrate()` reads the migrations dir, applies each unapplied file inside `batch([...], "write")` and inserts into `schema_migrations`. `WALKMYCODE_DB_URL=file::memory:` gives tests a fresh database. Helpers: `one<T>(sql, args)`, `all<T>`, `run(sql, args) → rowsAffected`, `tx(fn)` wrapping `transaction("write")`, `now()` in whole seconds.

## 6. Route handlers (Next 16 App Router, `export const runtime = "nodejs"`)

Read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` first, per AGENTS.md. Bodies are validated with `zod` v4 (installed). Cookies are written with `cookies()` from `next/headers` (async) in route handlers only.

| Route | Method | Request → response |
|---|---|---|
| `src/app/api/auth/request/route.ts` | POST JSON `{email}` | 200 `{ok, message}`; 400 bad email; 429; 502 mail refused; 503 no mail; 404 byok; 403 origin |
| `src/app/api/auth/verify/route.ts` | POST JSON `{email, code}` | 200 `{ok, account}` + session cookie; 401 `{error:{code:"bad_code", message}}`; 429; 404; 403 |
| `src/app/api/auth/link/route.ts` | POST form `token`, `next?` | 303 `next ?? /map?signed_in=1[&same=1]` + cookie; else 303 `/signin/link?state=expired` |
| `src/app/signin/link/page.tsx` | GET page `?token` | button page or expired page; `force-dynamic`, `referrer: same-origin`, `robots: noindex` |
| `src/app/api/auth/me/route.ts` | GET | 200 `{mode, account: {id,email,display_name,role} \| null}`, `cache-control: no-store`; never throttled; in byok `{mode:"byok", account:null}` (200, not 404, so the badge can decide) |
| `src/app/api/auth/signout/route.ts` | POST | `{ok:true}`; cookie cleared |
| `src/app/api/auth/signout-all/route.ts` | POST | `{ok:true}`; 401 without session |
| `src/app/api/auth/delete/route.ts` | POST JSON `{confirm}` | `{ok:true}`; 400 mismatch; 401 |
| `src/app/api/auth/github/route.ts` | GET `?next` | 302 GitHub, state cookie |
| `src/app/api/auth/github/callback/route.ts` | GET `?code&state` | 303 `/map?signed_in=1` or `/signin?error=<enum>` |
| later `api/auth/token`, `api/auth/refresh` | POST | `{access_token, refresh_token}`; rotation + family reuse detection |

**Guard split** in `src/lib/providers/guard.ts` (exists today as `checkLocalSameOrigin` / `assertLocalSameOrigin` / `guarded`):

- `checkSameOrigin(req)`: (1) if `Sec-Fetch-Site` is present it must be `same-origin` or `none`; (2) else `Origin` must be present for non-GET/HEAD/OPTIONS and equal `expectedOrigin()`; a write with **neither** header is refused; (3) writes must be `application/json` unless the handler opts in to `application/x-www-form-urlencoded` (`{form: true}`, only `/api/auth/link`). `expectedOrigin()` = `new URL(SITE_URL).origin` when `SITE_URL` is set, else `scheme://Host` (byok on localhost). `assertSameOrigin(req, opts)` throws `ForbiddenError`.
- `checkLocal(req)`: `Host` must be loopback unless `WALKMYCODE_ALLOW_REMOTE=1`. `assertLocal` is used only by `/api/config*` in byok mode.
- `guarded(handler, {local?, form?})` keeps its current error mapping and runs `assertSameOrigin` always, `assertLocal` when `local: true`.
- `/api/claude/route.ts` becomes `export const POST = guarded(async (req) => { const { account } = await gate(req, { require: true }); … })` — the origin guard applies in byok too (today a cross-site page can drive it); `gate` is a no-op there. Later `/api/ai` inherits both lines, and usage rows and holds hang off `account.id`.

`proxy.ts` is not used for auth: Next's guide reserves it for optimistic redirects; the gate lives with the data it protects.

New codes in `src/lib/providers/wire.ts` `ErrorCode`: `"sign_in" | "suspended"`; copy in `friendly()` (`errors.ts`) as in §1 D; `FriendlyError` gains optional `action?: "sign_in"`.

## 7. Mail — `src/lib/mail.ts`

`sendMail({to, subject, text}, deps = {fetch}) → Promise<boolean>`: `RESEND_API_KEY` set → `POST https://api.resend.com/emails` (`Authorization: Bearer`, `from: MAIL_FROM`, `reply_to: MAIL_REPLY_TO || undefined`, 15 s timeout) → `true`; non-2xx or network error → `throw new MailError(status)`; nothing configured → `false`. `canSendMail()`, `mayLogCodes() = WALKMYCODE_DEV_CODES === "1" && NODE_ENV !== "production"`. SMTP via nodemailer stays a later option.

Subject **"Your WalkMyCode sign-in code"**. Body:

```
Hello,

Your WalkMyCode sign-in code is:

    ABC-DEF

Type it into the tab where you asked for it. The code only works there.

Or open this link on the device you want to use WalkMyCode on — it signs in that device:

{url}

The code and the link both work once and expire in 10 minutes.

If you did not ask to sign in, you can ignore this. Nobody can get in without the code, and it only works in the browser that asked for it.

— WalkMyCode
```

## 8. The sign-in screen — `src/components/SignIn.tsx`

Mounted at `src/app/signin/page.tsx` and inline inside the Guide board when the gate answers `sign_in`. Built from `.frame > .board`, `.panel`, `.field`, `.ctl`, `.note`, `.err` plus ~40 lines in `globals.css` (`.signin`, `.codeboxes`, `.codebox`, `.or`). Kalam chalk on the board; Inter for controls.

**State 1 — ask for a code.** Board: **"Sign in to ask the guide"** / "The map, the code and the traces are yours to explore for free. Explaining, asking questions and tours need an account, so credits have somewhere to live." Field `EMAIL ADDRESS`, placeholder `you@example.com`, helper "We send a code. There is no password to create or remember." Button **Send code**. Rule "or", then **Continue with GitHub** (ghost button with the mark; hidden when `/api/auth/me` reports `github: false`). Footer: "Signing in creates your account if you don't have one. Read what we keep: Privacy." (`/privacy`). A `?error=` from the enum in §1 C renders above the field in `.err`.

**State 2 — enter the code.** Board: **"Check your email"** / "We sent a code to **{email}**. Type it here — it only works in this tab. The link in the email signs in whichever device you open it on; if you open it in this browser, this tab will notice." Six `.codebox` inputs (auto-advance, paste fills all six, uppercase, gap after the third), **Sign in** button (enabled at 6 chars; Enter submits). Notes: "Codes last 10 minutes and work once." · "Nothing arrived? Check spam, then **send it again**" (link disabled for 60 s with a countdown, matching the server cooldown; a resend reuses the same requester cookie so both codes work). Error `.err`: "That code did not work. Check the email again, or ask for a new one." · "Wrong address? **Start over**." While State 2 shows, poll `GET /api/auth/me` every 2 s (stop after 10 minutes); `account` non-null → State 3.

**State 3 — signed in.** Toast "Signed in as {email}." then navigate to `safeNext` (client-side mirror of the same rule) or `/map`. `/map?signed_in=1` shows the same toast once and strips the query.

**Link page** `/signin/link`: **"Sign in to WalkMyCode"** / "Finish signing in as **{email}** on this device." Button **Sign in**. Expired (`?state=expired` or lookup miss): **"This link has expired"** / "Sign-in codes and links last 10 minutes and work once. Ask for a new one in WalkMyCode." with a link to `/signin`.

**Header pill** `src/components/AccountBadge.tsx` (beside the cost pill in `map/page.tsx`, and in the connect screen header): byok → renders nothing; hosted signed out → **Sign in**; signed in → `you@example.com ▾` with **Sign out (this browser)**, **Sign out everywhere**, **Delete account…** (confirm dialog asks to retype the address).

**Guide.tsx** on `code: "sign_in"`: board text "**Sign in to ask the guide.** The map is yours to explore; asking needs an account so we can keep track of credits." with **Sign in** opening `SignIn` inline; the map stays. On `code: "suspended"`: the friendly title/message, no button.

## 9. Privacy text

Connect screen "What happens to your code" board (hosted only) gains: "**Signing in** sends your email address to us and to **Resend**, which delivers the code and keeps a copy of the email it sent for a short time. If you use GitHub, GitHub tells us your verified email and your name, nothing else, and we do not keep the GitHub token. We keep your email, when you signed up and last used WalkMyCode, and which browsers are signed in. Codes, links and session tokens are stored only as one-way hashes. Your IP address is turned into a hashed rate-limit counter that lives for half an hour; our hosting provider's access logs keep addresses for a few days. We never store your code, your questions or the guide's answers."

`src/app/privacy/page.tsx` (same wall), sections:
- **What we collect** — account: email, display name only if GitHub supplied one, sign-in dates, signed-in browsers (browser name + OS, not the raw user agent). Usage: time, model, tokens and cost of each AI call, never the content.
- **Who sees what** — Resend: your address and the sign-in email (it retains sent bodies, which contain the link, for its stated retention). GitHub: sign-in only. The model provider you pick and Deepgram: snippets, questions, audio — one sentence per provider generated from `catalogue.ts` `privacy` fields so the page cannot drift from what the app can call. Our host: standard access logs with IP addresses for N days (N filled from `HOST_LOG_DAYS`).
- **What we never keep** — your code, your map, your questions and answers, passwords (there are none), GitHub tokens, IP addresses beyond the hashed half-hour counter.
- **How long** — account data while the account exists; sign-in rows 24 hours after expiry; sessions 30 days after expiry or revocation; usage records 24 months; purchase records 7 years after deletion for tax.
- **Your rights** — UK/EU GDPR and Ghana Data Protection Act 2012 (Act 843). Delete yourself from the account menu, or write to privacy@<domain>; answered within 30 days. Deleting anonymises the account row (email replaced by an opaque id), signs out every browser and removes sign-in and identity rows at once; purchase records stay for the tax period with no email attached.

## 10. Environment — `.env.example` additions

```
WALKMYCODE_MODE=byok                         # hosted | byok (byok: no accounts, no ledger; /api/auth/* is 404)
SITE_URL=http://localhost:3000            # required in hosted mode; sets cookie Secure/__Host-, the same-origin check, emailed links, GitHub redirect_uri
WALKMYCODE_DB_URL=file:.walkmycode/walkmycode.db   # or libsql://<db>.turso.io with WALKMYCODE_DB_AUTH_TOKEN
WALKMYCODE_DB_AUTH_TOKEN=
WALKMYCODE_AUTH_SECRET=                      # openssl rand -base64 32 ; WalkMyCode's own, never shared; all keys are HKDF-derived from it
RESEND_API_KEY=
MAIL_FROM=WalkMyCode <hello@example.com>
MAIL_REPLY_TO=
WALKMYCODE_DEV_CODES=0                       # 1 prints sign-in codes to the server log when no mail is configured; ignored when NODE_ENV=production
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
ADMIN_EMAILS=                             # comma-separated; read on every request, never cached in the database
WALKMYCODE_TRUSTED_PROXY=0                   # 1 behind nginx/Caddy: believe the LAST x-forwarded-for hop for rate limits
HOST_LOG_DAYS=7                           # shown on /privacy
```

Hosted also sets `WALKMYCODE_ALLOW_REMOTE=1` (provider spec).

## 11. How this meets the owner's three requirements together

Registration is this design and the hook for the other two: connecting several repos or services into one workspace (SERVICES.md) is saved per account in hosted mode; the dockable, resizable layout (SHELL.md) is saved per browser in `localStorage` in v1 and can move to the account later because `accounts`/`sessions` already exist to hang it on. BYOK and Lite lose nothing: `gate()` short-circuits, `/api/auth/*` is 404, the badge and card never render.

## 12. Ordered task list (each leaves `npm run typecheck` and `npm test` green; BYOK keeps working throughout)

1. **Dependency + config** — `package.json`: `@libsql/client` exact pin. `.env.example` §10. `src/lib/mode.ts`: `mode()`, `siteOrigin()`, `isSecureSite()`. `src/instrumentation.ts`: hosted boot checks (secret length, `SITE_URL`), register housekeeping.
2. **Database** — `src/lib/db/index.ts`, `src/lib/db/migrations/0001_accounts.sql`, `src/lib/db/housekeeping.ts`. `tests/db.test.ts`.
3. **Primitives** — `src/lib/auth/keys.ts` (`subkey`), `src/lib/auth/tokens.ts` (`secret`, `sha256`, `authCode`, `normaliseAuthCode`, `formatAuthCode`, `normaliseEmail`, `looksLikeEmail`, `sameSecret`, `codeHash`, `safeNext`). `tests/auth-tokens.test.ts`.
4. **Throttle + mail** — `src/lib/auth/throttle.ts` (`hit`, `ipKey`), `src/lib/mail.ts`. `tests/throttle.test.ts`, `tests/mail.test.ts`.
5. **Accounts + sessions** — `src/lib/auth/accounts.ts` (`upsertAccount`, `accountById`, `blockAccount`, `deleteAccount`), `src/lib/auth/session.ts` (`startSession`, `readSession`, `endSession`, `endAllSessions`, `cookieName`, `cookieAttrs`). `tests/session.test.ts`.
6. **Sign-in core** — `src/lib/auth/signin.ts` (`requestCode`, `verifyCode`, `lookupLink`, `spendLink`). `tests/signin.test.ts`.
7. **Guard split + gate** — edit `src/lib/providers/guard.ts` (`checkSameOrigin`/`assertSameOrigin`, `checkLocal`/`assertLocal`, `guarded(handler, opts)`; keep `checkLocalSameOrigin` as a deprecated alias until `/api/config*` moves); `src/lib/auth/gate.ts`; `sign_in`/`suspended` in `wire.ts` + `errors.ts`. `tests/gate.test.ts`, extend `tests/errors.test.ts`.
8. **Route handlers** — `src/app/api/auth/{request,verify,link,me,signout,signout-all,delete}/route.ts`, `src/app/signin/link/page.tsx`; `/api/claude` wrapped in `guarded` + `gate`. `tests/auth-routes.test.ts`.
9. **UI** — `SignIn.tsx`, `AccountBadge.tsx`, `src/app/signin/page.tsx`, `globals.css`, `map/page.tsx` (badge, `?signed_in=1` toast), `src/app/page.tsx` (badge + privacy sentence), `Guide.tsx` (`sign_in` inline card, `suspended` text). Manual checkpoint on `next dev` with `WALKMYCODE_MODE=hosted WALKMYCODE_DEV_CODES=1 WALKMYCODE_AUTH_SECRET=… SITE_URL=http://localhost:3000`: ask → card → code from terminal → signed in → ask works → sign out → ask blocked → link in a private window signs in that window only.
10. **GitHub** — `src/lib/auth/github.ts` (`authorizeUrl`, `signState`/`verifyState`, `exchange`, `verifiedEmail`, injectable `fetch`), `api/auth/github/route.ts`, `callback/route.ts`. `tests/github.test.ts`.
11. **Privacy + docs** — `src/app/privacy/page.tsx`, README hosted setup (env, Resend domain DNS, GitHub OAuth app, `openssl rand`, backups: copy `.walkmycode/walkmycode.db` after `PRAGMA wal_checkpoint(TRUNCATE)` or use Turso), `docs/PLAN.md` privacy paragraph names Resend and GitHub, this file as `docs/ACCOUNTS.md`.
12. **Later** — `0002_tokens.sql` + `/api/auth/token`, `/refresh` (rotation, family reuse detection, 90 d); `0003_credits.sql`; nodemailer fallback; backoffice page reusing sessions with `role='admin'` and the same-origin guard on writes.

## 13. Tests (`tsx --test tests/**/*.test.ts`; no network, no keys)

Every file sets `process.env.WALKMYCODE_MODE="hosted"`, `WALKMYCODE_DB_URL="file::memory:"`, `WALKMYCODE_AUTH_SECRET=<32 bytes b64>`, `SITE_URL="http://localhost:3000"` unless stated, and resets the db between cases.

- **db.test.ts** — migrate twice is a no-op (`schema_migrations` has one row per file); `run()` returns `rowsAffected`; FK on with `ON DELETE CASCADE` for sessions.
- **auth-tokens.test.ts** — alphabet excludes I/L/O/U; `normaliseAuthCode("abc-def") === normaliseAuthCode("ab c.def") === "ABCDEF"`, `"abl-def"`→`"AB1DEF"`, `"ab0-def"`/`"abo-def"` equal; `formatAuthCode` gives `ABC-DEF`; `looksLikeEmail` table (valid, missing `@`, spaces, one-char TLD, 255 chars); `codeHash` differs for the same code with different emails and with different secrets; `safeNext` table: `/map` ok, `//evil.com` no, `/\evil` no, `javascript:alert(1)` no, `https://evil` no, `/map?x=1#y` ok, `/a\r\nSet-Cookie:` no, 600-char string no.
- **throttle.test.ts** — 10 hits pass, 11th fails, next window passes; counters persist across a new `db()` handle (same in-memory client); `ipKey` ignores XFF when untrusted; with `WALKMYCODE_TRUSTED_PROXY=1` uses the **last** entry of `"1.1.1.1, 2.2.2.2"`; key never contains the IP text.
- **mail.test.ts** — no key → `false`; fake fetch 200 → `true`; fake fetch 422 → throws `MailError`; `mayLogCodes()` true with `WALKMYCODE_DEV_CODES=1`+`NODE_ENV=test`, false with `NODE_ENV=production`.
- **session.test.ts** — cookie attributes: `HttpOnly; Path=/; SameSite=Lax`; `Secure` and `__Host-` iff `SITE_URL` is https even when the request `Host` is `localhost` and vice versa; `readSession` null after `endSession`, after expiry, after `endAllSessions`, for blocked and deleted accounts; sliding renewal after 3601 s extends by 30 d but never past `created_at+180 d`; `startSession` on a request that already carries a session cookie revokes that row and issues a different token.
- **signin.test.ts** (mail sink records `{to, subject, text}`; parses the code and the `token=` out of the text like a person) — happy path code: request → verify with the same requester cookie → account created, second verify fails; happy path link: `lookupLink` twice does not spend, `spendLink` once succeeds, again fails; **requester binding**: verify from a different cookie / no cookie fails and does **not** increment `attempts` on the victim's row; two requests from one browser → both codes work, each once; 60 s cooldown: second request sends nothing, response identical; unknown vs known address: identical response object; wrong code ×5 → row dead, sixth try with the right code fails; parallel 10 wrong guesses → `attempts` ends at exactly 5; expired (clock injected) fails; code typed with a different email fails; `codeHash` dump resistance: recomputing SHA-256 of every code does not match `code_hash`; **dev-mode path**: no mail configured + `WALKMYCODE_DEV_CODES=1` → `requestCode` succeeds and the captured console line contains `DEV code for user@example.com:` with a formatted `XXX-XXX` and a link under `SITE_URL`; the same with `NODE_ENV=production` → 503 and no console line; 5-second `link_fast_spend` counter increments when spend follows lookup within 5 s.
- **gate.test.ts** — byok: `require` never throws, `account` null; hosted no cookie → 401 `sign_in`; blocked → 403 `suspended`; deleted → `sign_in`; valid → account; `ADMIN_EMAILS` promotes role in the response without touching `accounts.role`; Bearer header ignored until tokens ship.
- **auth-routes.test.ts** (calls exported `POST`/`GET` with `Request` objects) — foreign `Origin` → 403; POST with neither `Sec-Fetch-Site` nor `Origin` → 403; `Sec-Fetch-Site: cross-site` → 403; `WALKMYCODE_MODE=byok` → 404 for every auth route but `/me` (200 `{mode:"byok"}`); `/request` with bad email → 400, valid → 200 body and a `walkmycode_signin` `Set-Cookie`; full flow through the handlers with cookies carried by hand: request → verify → `/me` shows the account → `/signout` → `/me` null → `/signout-all` 401; link page GET with a live token renders the email and does not spend, with a spent token renders the expired copy; GET response headers include `referrer-policy: same-origin`, `cache-control` contains `no-store`, `x-robots-tag`/`robots` meta noindex; link POST without `Sec-Fetch-User: ?1` (but with `Sec-Fetch-Mode: navigate`) → expired page and the row is **not** spent; link POST with `next=//evil.com` → redirect to `/map?signed_in=1`; link POST from the same requester cookie → `Location` contains `same=1`; `/delete` with wrong `confirm` → 400, right → 200, email replaced by `deleted:acc_…`, sessions revoked, identities gone; `/api/claude` POST with a foreign origin → 403 in byok mode; in hosted without a session → 401 `{error:{code:"sign_in"}}`.
- **github.test.ts** (fake fetch) — state cookie signature tampered → `github_state`; state mismatch → `github_state`; `iat` older than 600 s → `github_state`; no verified primary email → `github_email`; new GitHub user → account + identity rows; existing identity with a changed GitHub email → signs into the identity's account and does not create a second; GitHub 500 → `github_down`; `next` in the state cookie survives and is validated by `safeNext`; the access token appears nowhere in the database.

**curl checks for task 8** (`next dev` with `WALKMYCODE_MODE=hosted WALKMYCODE_DEV_CODES=1`):
`curl -X POST localhost:3000/api/auth/request -H 'content-type: application/json' -H 'origin: https://evil.example' -d '{"email":"a@b.co"}'` → 403;
same with `-H 'origin: http://localhost:3000' -c jar.txt` → 200 and the terminal prints the DEV code line;
repeat within 60 s → 200, identical body, no new code line;
`curl -X POST localhost:3000/api/auth/verify -b jar.txt -c jar.txt -H 'content-type: application/json' -H 'origin: http://localhost:3000' -d '{"email":"a@b.co","code":"<printed>"}'` → 200 + session cookie;
the same verify **without** `-b jar.txt` → 401 `bad_code`;
`curl localhost:3000/api/auth/me -b jar.txt` → account;
`WALKMYCODE_MODE=byok` restart → `/api/auth/request` → 404.

## 15. Owner's decisions (30 Sep 2026)

1. **Sender:** `support@<the WalkMyCode domain>` (domain not bought yet; Resend DNS records go on it then). Replies go to the same address.
2. **GitHub:** a **GitHub App** from the start (installation-based, fine-grained `Contents: read`, users grant once, short-lived installation tokens) — sign-in and later read-only repo access use the same app. Not a plain OAuth App.
3. **Database:** **Turso in hosted mode, a local SQLite (libsql) file in self-host/BYOK mode.** Identical code; the mode picks the URL. Hosted gets a replica, backups and point-in-time restore with nothing to run; self-hosters need no account.

## 14. Open questions — answered above (kept for the record)

1. **Domain and sender.** Which domain sends the codes (Resend needs DNS records for it) and which address answers replies — `hello@` / `support@` / `privacy@`?
2. **GitHub app type.** An OAuth App is enough for sign-in. Read-only repo access later is cleaner as a GitHub App (fine-grained "Contents: read"); shall sign-in use the GitHub App from the start so people grant once?
3. **Turso from day one, or a file on the VPS?** The code is identical; Turso adds a hosted replica and point-in-time restore, the file adds nothing to run.

---
