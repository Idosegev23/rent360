# Google integration (Calendar + Gmail) — design spec

**Date:** 2026-06-10
**Status:** Approved (design); pending implementation plan
**Author:** brainstormed with the user

## 1. Goal

Let each rent360 team member connect their own Google account so the system can,
acting **as that user**:

- **Calendar:** create events (callback reminders, viewing/meeting coordination).
- **Gmail:** send outgoing emails (client summaries, team notifications).

OAuth is done **directly against Google** (credentials in env), *not* brokered by
Supabase. Supabase still provides the app session that tells us *which* team member
is acting (`auth.uid()`); the Google connection attaches Google API tokens to that user.

## 2. Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| What it does | Calendar = create events; Gmail = send mail (no inbound reading) |
| Account model | **Per-user** — every team member connects their own Google account |
| Trigger model | **Both** manual (UI buttons) and automatic (system) |
| Auto calendar routing | Event lands in the **lead's assigned owner**'s calendar; fallback to a configured org default (Shay) when unassigned |
| Auto email | **Deferred to v2** — no concrete trigger yet; v1 has manual send only |
| Implementation | Full **`googleapis`** SDK |

## 3. Non-goals (v1)

- Reading/searching inbound Gmail.
- Automatic outgoing email (no trigger defined yet) — deferred to v2.
- Google Drive / Sheets.
- Removing the existing Supabase Google **login** — it stays as-is; this is a separate
  "connect for API access" flow.

## 4. Architecture

```
Supabase session (sb-access-token cookie) ──► identifies team member (auth.uid() + users.org_id)
                                                       │
"Connect Google" (direct OAuth) ──► google_connections row (per user+org, refresh_token encrypted)
                                                       │
Calendar/Gmail action (manual or auto) ──► getGoogleClientForUser(orgId, userId)
                                                       │
                                            googleapis (auto token refresh) ──► Google API
```

### Components

1. OAuth routes: `/api/google/connect`, `/api/google/callback`, `/api/google/disconnect`.
2. DB: `google_connections` table; `threads.assigned_user_id`; `settings.default_calendar_user_id`.
3. `lib/google/oauth.ts` — OAuth2 client construction, consent URL, code exchange, `state` signing.
4. `lib/google/client.ts` — `getGoogleClientForUser(orgId, userId)` → authed OAuth2 client, persists refreshed access tokens.
5. `lib/google/calendar.ts` — `createCalendarEvent(...)`.
6. `lib/google/gmail.ts` — `sendGmail(...)`.
7. `lib/crypto/secret-box.ts` — AES-256-GCM encrypt/decrypt for the refresh token.
8. Action API routes: `POST /api/google/calendar/event`, `POST /api/google/gmail/send`.
9. UI: connect/disconnect in settings; "הוסף ליומן" / "שלח מייל" buttons on lead/property views.
10. Auto hook: when `callback_at` is recorded, best-effort create a calendar event.

## 5. Data model

### 5.1 `google_connections` (new table)

| column | type | notes |
|---|---|---|
| id | uuid pk | `gen_random_uuid()` |
| org_id | uuid not null | tenant |
| user_id | uuid not null | Supabase `auth.uid()` — **verified** equal to `users.id` (auth lookups do `users.eq('id', uid)`); FK `references users(id)` |
| google_email | text | the connected Google address (display) |
| access_token | text | short-lived; refreshed as needed |
| refresh_token | text | long-lived — **encrypted at rest** |
| scopes | text[] | granted scopes |
| token_expiry | timestamptz | access-token expiry |
| status | text | `'active'` \| `'invalid'` (set on refresh failure / revoke) |
| created_at / updated_at | timestamptz | defaults `now()` |

- **Unique** `(org_id, user_id)` → reconnect upserts.
- RLS: a user may select/delete only their own row (`user_id = auth.uid()`); service role bypasses.
  All server writes go through `supabaseService()` with explicit `org_id` + `user_id` filters.

### 5.2 `threads.assigned_user_id` (new nullable column)

`uuid references users(id)`. Identifies the team member responsible for a thread/lead.
Used to route automatic calendar events. Nullable; when null, auto events fall back to
`settings.default_calendar_user_id`.

### 5.3 `settings.default_calendar_user_id` (new column)

Org-level fallback owner for automatic calendar events. The `settings` table is one row
per org (jsonb config blobs: `matching_weights`, `quiet_hours`, `messaging_defaults`) — add a
typed nullable column `default_calendar_user_id uuid references users(id)` (cleaner than a
jsonb key for this FK-like reference). Seed to Shay's user id.

## 6. OAuth flow

**Scopes:**
- `openid`, `email`, `profile` (identity / connected-email display)
- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/gmail.send`

**`GET /api/google/connect`**
- Require a valid Supabase session (decode `sb-access-token`); 401 if absent.
- Build consent URL via `googleapis` OAuth2: `access_type=offline`, `prompt=consent`
  (forces a refresh_token even on re-consent), `include_granted_scopes=true`.
- `state` = HMAC-signed payload `{ userId, orgId, nonce }` (nonce stored in a short-lived
  signed cookie) for CSRF protection.
- 302 redirect to Google.

**`GET /api/google/callback`**
- Verify `state` signature + nonce cookie.
- Exchange `code` → `{ access_token, refresh_token, expiry_date, scope }`.
- Call userinfo to get the Google email.
- Encrypt `refresh_token`; upsert `google_connections` on `(org_id, user_id)`.
  - If Google omits `refresh_token` (can happen when the user previously consented and
    we didn't force it) — keep the existing stored refresh_token rather than nulling it.
- Redirect to the settings page with `?google=connected` (or `?google=error`).

**`POST /api/google/disconnect`**
- Revoke the token at Google (`https://oauth2.googleapis.com/revoke`), delete the row.

### Redirect URIs to register in Google Console (Web client)
```
https://rent360-vert.vercel.app/api/google/callback   (production)
http://localhost:3000/api/google/callback              (local dev)
```
Authorized JavaScript origins: `https://rent360-vert.vercel.app`, `http://localhost:3000`.

### ⚠️ Publishing status, verification & refresh-token lifetime
The OAuth consent screen is **Published ("In production")**, User type External.
- **Test Users are a *Testing*-mode concept only** — once the app is Published they no longer
  apply, so there is **no need to add the team as Test Users**.
- Publishing is the **correct** choice here: in *Testing* mode Google expires refresh tokens
  after **7 days** (forcing weekly reconnects); in *Production* refresh tokens are long-lived,
  which matches our stored per-user refresh-token model.
- `calendar.events` and `gmail.send` are **sensitive** scopes and the app is not *verified*, so
  on first connect users see an **"unverified app" warning** ("Google hasn't verified this app").
  They proceed via **Advanced → Go to rent360 (unsafe)** and grant access — acceptable for an
  internal 4-person team. Completing Google verification later removes the warning and lifts the
  ~100-user cap; not required to use it now.
- Confirm consent-screen **User type = External** (plain Gmail accounts, not a Workspace org).

**Removing the red "unverified app" screen:** the team has no Google Workspace, so the fast
"Internal" path is unavailable. The only way to remove the warning is full **External
verification**, which requires a **custom domain you own** (the `*.vercel.app` URL is NOT
verifiable in Search Console), a privacy policy + terms + home page on that domain, an app
logo, per-scope justifications, and a demo video — review takes days to weeks (sensitive
scopes, no CASA). **Decision: defer verification.** For the 4-person team the warning is a
one-time per-user click-through (Advanced → proceed) and does not block anything; revisit
verification if/when a custom domain exists or usage expands.

## 7. Token security

- Encrypt `refresh_token` with **AES-256-GCM** (`lib/crypto/secret-box.ts`), key from new
  env `GOOGLE_TOKEN_ENC_KEY` (32-byte, base64). Store `iv:tag:ciphertext`.
- `access_token` is short-lived; storing it plaintext is acceptable, but it lives in the
  same row and is only readable via service role.
- Never expose tokens to the browser. All Google calls are server-side (mirrors the
  `lib/whatsapp/meta-provider.ts` "server-only" rule).

## 8. Code layer (API contracts)

```ts
// lib/google/client.ts
class GoogleNotConnectedError extends Error {}        // no/invalid connection for this user
getGoogleClientForUser(orgId: string, userId: string): Promise<OAuth2Client>
// loads the row, sets credentials, attaches a 'tokens' listener that persists refreshed
// access_token + expiry. Throws GoogleNotConnectedError if missing or status='invalid'.

// lib/google/calendar.ts
createCalendarEvent(args: {
  orgId: string; userId: string;
  summary: string; description?: string;
  start: Date; end: Date; attendees?: string[]; timeZone?: string; // default 'Asia/Jerusalem'
}): Promise<{ eventId: string; htmlLink: string }>

// lib/google/gmail.ts
sendGmail(args: {
  orgId: string; userId: string;
  to: string | string[]; subject: string; text: string; html?: string;
}): Promise<{ messageId: string }>
// builds RFC822 MIME (handled via googleapis raw), UTF-8 subject/body for Hebrew.
```

On refresh failure (revoked/expired refresh token), set `status='invalid'` and rethrow as
`GoogleNotConnectedError` so callers prompt reconnect.

## 9. HTTP endpoints (manual actions)

- `POST /api/google/calendar/event` — body `{ summary, description?, start, end, attendees? }`.
  Acts as the **logged-in** Supabase user. 409/428 with a clear Hebrew message if not connected.
- `POST /api/google/gmail/send` — body `{ to, subject, text, html? }`. Acts as the logged-in user.

Both resolve `org_id`/`user_id` from the session cookie (the UI-facing auth path), never from
the request body.

## 10. UI

- **Settings page:** "חבר חשבון Google" → `/api/google/connect`. When connected, show the
  Google email, granted scopes, and a "נתק" (disconnect) button. Reflect `?google=connected|error`.
- **Lead / property / inbox views:** "הוסף ליומן" (small form: title + datetime, prefilled from
  context) and "שלח מייל" (compose: to / subject / body). Disabled with a "חבר חשבון Google
  קודם" hint when the current user has no active connection.
- All copy gender-neutral (project convention).

## 11. Automatic trigger (v1): callback reminder → calendar event

- Where `callback_at` is recorded (landlord-outreach `record_landlord_intent` /
  `approve_brokerage` path), after the DB write, **best-effort** create a calendar event:
  - **Owner resolution:** `threads.assigned_user_id` → else `settings.default_calendar_user_id`
    (Shay) → else skip + log.
  - Event: summary `חזרה ל<owner name / property>`, start = `callback_at`, end = +30m,
    description with thread/property link.
- Wrapped in try/catch; a Google failure must **never** block intent recording or the
  conversation flow (same best-effort pattern as `notifyAdminsHandoff`).
- Idempotency: store the created `eventId` in `threads.tags.calendar_event_id`; if a callback
  time changes, update the existing event instead of creating a duplicate.

## 12. Error handling & edge cases

- **Not connected:** typed `GoogleNotConnectedError`; manual endpoints return a clear Hebrew
  "חבר חשבון Google קודם"; auto flow skips silently + logs.
- **Refresh fails / revoked:** mark `status='invalid'`, prompt reconnect; auto flow skips.
- **Missing scope** (user granted only some): detect from `scopes`; surface which action is
  unavailable and offer reconnect.
- **Demo/no-Supabase fallback:** consistent with existing handlers — if service env missing,
  endpoints no-op gracefully.

## 13. Env vars

Add to `.env.example` and production:
- `GOOGLE_CLIENT_ID` (set), `GOOGLE_CLIENT_SECRET` (set)
- `GOOGLE_REDIRECT_URI` (e.g. `https://rent360-vert.vercel.app/api/google/callback`) — or derive
  from `APP_BASE_URL`; explicit is safer across the three-app family.
- `GOOGLE_TOKEN_ENC_KEY` (new, 32-byte base64) — refresh-token encryption.

`middleware.ts`: `/api/google/callback` must be reachable mid-OAuth. `/connect` requires a
session. Add to the public allowlist only what must be public (the callback); keep `/connect`
and action routes behind auth.

## 14. Multi-tenancy & security

- Every `google_connections` query filters by `org_id` AND `user_id`.
- Tokens server-side only; refresh token encrypted.
- `state` HMAC + nonce cookie prevents OAuth CSRF.
- RLS on the new table; service-role writes enforce scoping explicitly.

## 15. Testing / verification (no test runner in repo)

Manual, in dev against a real Test-User Google account:
1. Connect flow stores a row with an encrypted refresh_token; settings shows the email.
2. Manual "הוסף ליומן" creates a visible event on that account's calendar.
3. Manual "שלח מייל" delivers a Hebrew email (correct UTF-8 subject/body).
4. Force access-token expiry → next call auto-refreshes and persists the new token.
5. Revoke access at Google → next call sets `status='invalid'` and the UI prompts reconnect.
6. Auto: set a `callback_at` → event lands in assigned owner's calendar; unassigned → falls to
   the default owner; neither connected → skipped, flow unaffected.

## 16. Rollout

1. Migration: `google_connections`, `threads.assigned_user_id`, `settings.default_calendar_user_id`.
2. `npm i googleapis`.
3. Implement crypto + oauth + client + service wrappers.
4. OAuth routes + middleware allowlist.
5. Action endpoints + UI.
6. Auto callback hook.
7. Console: register redirect URIs (consent screen already Published/External; no Test Users needed — expect the "unverified app" warning, proceed via Advanced).
8. Set env vars in prod; `npx vercel --prod` (deploy is manual — not git-auto).

## 17. Future (v2)

- Automatic outgoing email once a concrete trigger is defined.
- Inbound Gmail (lead capture from email).
- Drive/Sheets (e.g., replace the manual sheet import).
- Per-thread assignment UI if not already added in v1.
