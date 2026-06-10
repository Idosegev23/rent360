# Google Calendar + Gmail Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each team member connect their own Google account so the system can create Calendar events and send Gmail messages as that user (manual UI actions + automatic callback-reminder events).

**Architecture:** Direct Google OAuth (not via Supabase). The Supabase session identifies *which* team member is acting (`auth.uid()` == `users.id`); a per-user `google_connections` row stores tokens (refresh token AES-256-GCM encrypted). The `googleapis` SDK handles API calls and token refresh. Automatic callback events route to the thread's `assigned_user_id`, falling back to `settings.default_calendar_user_id`.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase (service role), `googleapis`, Node `crypto`, `zod`, `nanoid`.

**Spec:** [docs/superpowers/specs/2026-06-10-google-calendar-gmail-integration-design.md](../specs/2026-06-10-google-calendar-gmail-integration-design.md)

---

## Testing note (read first)

This repo has **no test runner** (`npm test` is a placeholder; see CLAUDE.md). Per the user's instruction, we do **not** add a framework. Verification is:
- **Pure-logic units** (crypto, OAuth state, MIME): a throwaway Node script under `/tmp` run with `node`. Write the verify script *before* the implementation (TDD-style), watch it fail, then implement.
- **Integration** (routes, Google calls, UI): manual `curl` / browser / Supabase SQL checks, described per task.

All new server code imports via the `@/*` alias (→ repo root, per CLAUDE.md). All work happens on the existing branch `feature/google-integration`. Commit after every task.

---

## File structure

**Create:**
- `supabase/migrations/0018_google_integration.sql` — `google_connections` table + `threads.assigned_user_id` + `settings.default_calendar_user_id`.
- `lib/crypto/secret-box.ts` — AES-256-GCM encrypt/decrypt.
- `lib/google/config.ts` — scopes, OAuth config, `isGoogleConfigured`.
- `lib/google/oauth.ts` — OAuth2 client, consent URL, code exchange, signed `state`.
- `lib/google/connections.ts` — DB layer (encrypt/decrypt at the boundary).
- `lib/google/client.ts` — `getGoogleClientForUser`, `GoogleNotConnectedError`, `isGoogleAuthError`.
- `lib/google/calendar.ts` — `createCalendarEvent`, `updateCalendarEvent`.
- `lib/google/gmail.ts` — `sendGmail` (+ MIME builder).
- `lib/google/auto-callback-event.ts` — resolve owner + create/update the callback event.
- `app/api/google/connect/route.ts`, `app/api/google/callback/route.ts`, `app/api/google/status/route.ts`, `app/api/google/disconnect/route.ts`.
- `app/api/google/calendar/event/route.ts`, `app/api/google/gmail/send/route.ts`.
- `app/api/v1/inbox/threads/[id]/assign/route.ts`.
- `components/google/GoogleConnectionCard.tsx`, `components/google/ThreadGoogleActions.tsx`.

**Modify:**
- `.env.example` — new Google vars.
- `middleware.ts:32-39` — allowlist `/api/google/callback`.
- `lib/ai/landlord-outreach/tools.ts` — `recordIntent` fires the auto callback-event hook.
- `app/admin/page.tsx` — mount `GoogleConnectionCard`.
- `app/inbox/[id]/page.tsx` — mount `ThreadGoogleActions` (assignment + calendar/email buttons).
- `package.json` — `googleapis` dependency.

---

## Task 1: Dependencies + env scaffolding

**Files:**
- Modify: `package.json` (via npm)
- Modify: `.env.example`

- [ ] **Step 1: Install googleapis**

Run: `npm i googleapis`
Expected: `package.json` dependencies now include `googleapis`; no install errors.

- [ ] **Step 2: Generate a 32-byte encryption key**

Run: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
Copy the output — this is `GOOGLE_TOKEN_ENC_KEY`. Add it to `.env.local` (untracked) now, and to Vercel prod later.

- [ ] **Step 3: Add the new vars to `.env.example`**

Append to `.env.example`:

```bash
# Google integration (direct OAuth — Calendar events + Gmail send, per-user)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Defaults to ${APP_BASE_URL}/api/google/callback when unset:
GOOGLE_REDIRECT_URI=
# 32-byte base64 key for encrypting stored refresh tokens (openssl rand -base64 32):
GOOGLE_TOKEN_ENC_KEY=
```

- [ ] **Step 4: Confirm the `@/*` alias resolves**

Run: `node -e "const t=require('./tsconfig.json'); console.log(JSON.stringify(t.compilerOptions.paths))"`
Expected: shows a `@/*` → `./*` mapping. If absent, use relative imports instead throughout (the rest of the plan assumes `@/`).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add googleapis dep + Google env vars to example"
```

---

## Task 2: Database migration

**Files:**
- Create: `supabase/migrations/0018_google_integration.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0018_google_integration.sql`:

```sql
-- 0018: Google integration (per-user Calendar + Gmail). Additive + idempotent.

CREATE TABLE IF NOT EXISTS public.google_connections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  google_email  text,
  access_token  text,
  refresh_token text,                              -- AES-256-GCM ciphertext "iv:tag:data"
  scopes        text[],
  token_expiry  timestamptz,
  status        text NOT NULL DEFAULT 'active',    -- 'active' | 'invalid'
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_google_connections_org_user
  ON public.google_connections (org_id, user_id);

DROP TRIGGER IF EXISTS trg_google_connections_updated_at ON public.google_connections;
CREATE TRIGGER trg_google_connections_updated_at BEFORE UPDATE ON public.google_connections
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.google_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS google_connections_self ON public.google_connections;
CREATE POLICY google_connections_self ON public.google_connections
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS default_calendar_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
```

- [ ] **Step 2: Apply via Supabase MCP**

Use the `mcp__supabase__apply_migration` tool with name `0018_google_integration` and the SQL above (the project uses Supabase MCP for DDL — see memory `reference_supabase_mcp`).
Expected: success, no error.

- [ ] **Step 3: Verify the schema landed**

Use `mcp__supabase__execute_sql`:
```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='google_connections' order by ordinal_position;
select column_name from information_schema.columns
where table_schema='public' and table_name='threads' and column_name='assigned_user_id';
select column_name from information_schema.columns
where table_schema='public' and table_name='settings' and column_name='default_calendar_user_id';
```
Expected: all columns present.

- [ ] **Step 4: Seed the default calendar owner (Shay)**

Use `mcp__supabase__execute_sql`:
```sql
update public.settings s
set default_calendar_user_id = u.id
from public.users u
where u.org_id = s.org_id and lower(u.email) = 'shay20036@gmail.com';
```
Expected: 1 row updated (org `11111111-1111-1111-1111-111111111111`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0018_google_integration.sql
git commit -m "feat(db): google_connections + thread assignment + default calendar owner"
```

---

## Task 3: Crypto secret-box (AES-256-GCM)

**Files:**
- Create: `lib/crypto/secret-box.ts`
- Verify: `/tmp/verify-secretbox.mjs`

- [ ] **Step 1: Write the failing verification script**

Create `/tmp/verify-secretbox.mjs`:

```js
process.env.GOOGLE_TOKEN_ENC_KEY = Buffer.from('0'.repeat(32)).toString('base64')
const { encryptSecret, decryptSecret } = await import('/Users/idosegev/Downloads/TriRoars/rent360/lib/crypto/secret-box.ts')
  .catch(async () => await import('file:///Users/idosegev/Downloads/TriRoars/rent360/lib/crypto/secret-box.js'))
const ct = encryptSecret('refresh-token-xyz')
if (ct === 'refresh-token-xyz') throw new Error('not encrypted')
if (decryptSecret(ct) !== 'refresh-token-xyz') throw new Error('roundtrip failed')
console.log('OK secret-box roundtrip')
```

> Note: `.ts` can't be imported by bare `node`. For the verify run, use `npx tsx /tmp/verify-secretbox.mjs` (tsx ships transitively; if unavailable run `npx -y tsx ...`).

- [ ] **Step 2: Run it — expect failure (module missing)**

Run: `npx -y tsx /tmp/verify-secretbox.mjs`
Expected: FAIL — cannot find `lib/crypto/secret-box`.

- [ ] **Step 3: Implement `lib/crypto/secret-box.ts`**

```ts
import crypto from 'crypto'

const ALGO = 'aes-256-gcm'

function key(): Buffer {
  const b64 = process.env.GOOGLE_TOKEN_ENC_KEY
  if (!b64) throw new Error('GOOGLE_TOKEN_ENC_KEY missing')
  const k = Buffer.from(b64, 'base64')
  if (k.length !== 32) throw new Error('GOOGLE_TOKEN_ENC_KEY must decode to 32 bytes')
  return k
}

/** Returns "ivB64:tagB64:dataB64". */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, key(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':')
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('bad ciphertext format')
  const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}
```

- [ ] **Step 4: Run the verify script — expect PASS**

Run: `npx -y tsx /tmp/verify-secretbox.mjs`
Expected: `OK secret-box roundtrip`

- [ ] **Step 5: Commit**

```bash
git add lib/crypto/secret-box.ts
git commit -m "feat: AES-256-GCM secret-box for token encryption"
```

---

## Task 4: Google config

**Files:**
- Create: `lib/google/config.ts`

- [ ] **Step 1: Implement `lib/google/config.ts`**

```ts
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.send',
]

export function googleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET missing')
  const base = (process.env.APP_BASE_URL || 'https://rent360-vert.vercel.app').replace(/\/$/, '')
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${base}/api/google/callback`
  return { clientId, clientSecret, redirectUri }
}

export function isGoogleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0 (no new errors).

- [ ] **Step 3: Commit**

```bash
git add lib/google/config.ts
git commit -m "feat(google): OAuth config + scopes"
```

---

## Task 5: OAuth client, consent URL, state signing

**Files:**
- Create: `lib/google/oauth.ts`
- Verify: `/tmp/verify-state.mjs`

- [ ] **Step 1: Write the failing state-roundtrip verify script**

Create `/tmp/verify-state.mjs`:

```js
process.env.GOOGLE_TOKEN_ENC_KEY = Buffer.from('1'.repeat(32)).toString('base64')
process.env.GOOGLE_CLIENT_ID = 'x'; process.env.GOOGLE_CLIENT_SECRET = 'y'
const { signState, verifyState } = await import('file:///Users/idosegev/Downloads/TriRoars/rent360/lib/google/oauth.ts')
const s = signState({ uid: 'u1', orgId: 'o1', nonce: 'n1' })
const ok = verifyState(s)
if (!ok || ok.uid !== 'u1' || ok.nonce !== 'n1') throw new Error('roundtrip failed')
if (verifyState(s.slice(0, -2) + 'zz') !== null) throw new Error('tamper not rejected')
console.log('OK state sign/verify')
```

- [ ] **Step 2: Run it — expect failure (module missing)**

Run: `npx -y tsx /tmp/verify-state.mjs`
Expected: FAIL — cannot find `lib/google/oauth`.

- [ ] **Step 3: Implement `lib/google/oauth.ts`**

```ts
import { google } from 'googleapis'
import crypto from 'crypto'
import { googleOAuthConfig, GOOGLE_SCOPES } from '@/lib/google/config'

export function oauthClient() {
  const { clientId, clientSecret, redirectUri } = googleOAuthConfig()
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

function stateSecret(): string {
  return process.env.GOOGLE_TOKEN_ENC_KEY || process.env.SUPABASE_SERVICE_ROLE || 'dev-state-secret'
}

export type OAuthState = { uid: string; orgId: string; nonce: string }

export function signState(payload: OAuthState): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyState(state: string): OAuthState | null {
  const [body, sig] = state.split('.')
  if (!body || !sig) return null
  const expected = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthState } catch { return null }
}

export function consentUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',          // force a refresh_token even on re-consent
    include_granted_scopes: true,
    scope: GOOGLE_SCOPES,
    state,
  })
}

export async function exchangeCode(code: string) {
  const { tokens } = await oauthClient().getToken(code)
  return tokens // { access_token, refresh_token?, expiry_date, scope, id_token }
}
```

- [ ] **Step 4: Run the verify script — expect PASS**

Run: `npx -y tsx /tmp/verify-state.mjs`
Expected: `OK state sign/verify`

- [ ] **Step 5: Commit**

```bash
git add lib/google/oauth.ts
git commit -m "feat(google): OAuth client, consent URL, signed state"
```

---

## Task 6: Connections DB layer

**Files:**
- Create: `lib/google/connections.ts`

- [ ] **Step 1: Implement `lib/google/connections.ts`**

```ts
import { supabaseService } from '@/lib/supabase'
import { encryptSecret, decryptSecret } from '@/lib/crypto/secret-box'

export type GoogleConnection = {
  org_id: string
  user_id: string
  google_email: string | null
  access_token: string | null
  refresh_token: string | null   // decrypted plaintext when returned from getConnection
  scopes: string[] | null
  token_expiry: string | null
  status: string
}

export async function getConnection(orgId: string, userId: string): Promise<GoogleConnection | null> {
  const sb = supabaseService()
  const { data } = await sb
    .from('google_connections')
    .select('org_id, user_id, google_email, access_token, refresh_token, scopes, token_expiry, status')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!data) return null
  return { ...data, refresh_token: data.refresh_token ? decryptSecret(data.refresh_token) : null }
}

export async function upsertConnection(args: {
  orgId: string
  userId: string
  googleEmail: string | null
  accessToken: string | null
  refreshToken: string | null    // plaintext; null preserves existing
  scopes: string[] | null
  tokenExpiry: string | null
}): Promise<void> {
  const sb = supabaseService()
  let refreshEnc: string | null
  if (args.refreshToken) {
    refreshEnc = encryptSecret(args.refreshToken)
  } else {
    const { data } = await sb
      .from('google_connections')
      .select('refresh_token')
      .eq('org_id', args.orgId)
      .eq('user_id', args.userId)
      .maybeSingle()
    refreshEnc = data?.refresh_token ?? null
  }
  await sb.from('google_connections').upsert(
    {
      org_id: args.orgId,
      user_id: args.userId,
      google_email: args.googleEmail,
      access_token: args.accessToken,
      refresh_token: refreshEnc,
      scopes: args.scopes,
      token_expiry: args.tokenExpiry,
      status: 'active',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,user_id' },
  )
}

export async function updateAccessToken(
  orgId: string,
  userId: string,
  accessToken: string,
  tokenExpiry: string | null,
): Promise<void> {
  const sb = supabaseService()
  await sb
    .from('google_connections')
    .update({ access_token: accessToken, token_expiry: tokenExpiry, status: 'active' })
    .eq('org_id', orgId)
    .eq('user_id', userId)
}

export async function markInvalid(orgId: string, userId: string): Promise<void> {
  const sb = supabaseService()
  await sb.from('google_connections').update({ status: 'invalid' }).eq('org_id', orgId).eq('user_id', userId)
}

export async function deleteConnection(orgId: string, userId: string): Promise<void> {
  const sb = supabaseService()
  await sb.from('google_connections').delete().eq('org_id', orgId).eq('user_id', userId)
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/google/connections.ts
git commit -m "feat(google): connections DB layer with encrypted refresh tokens"
```

---

## Task 7: Authed client + error helpers

**Files:**
- Create: `lib/google/client.ts`

- [ ] **Step 1: Implement `lib/google/client.ts`**

```ts
import { oauthClient } from '@/lib/google/oauth'
import { getConnection, updateAccessToken, markInvalid } from '@/lib/google/connections'

export class GoogleNotConnectedError extends Error {
  constructor(msg = 'google_not_connected') {
    super(msg)
    this.name = 'GoogleNotConnectedError'
  }
}

/** True when a Google API error means the stored grant is no longer usable. */
export function isGoogleAuthError(err: unknown): boolean {
  const e = err as { code?: number; response?: { status?: number }; message?: string }
  const status = e?.code ?? e?.response?.status
  return status === 401 || !!e?.message?.includes('invalid_grant')
}

/**
 * Build an authed OAuth2 client for a user. googleapis auto-refreshes the access token on
 * API calls; we persist the refreshed token via the 'tokens' event. Throws
 * GoogleNotConnectedError if there is no active connection with a refresh token.
 */
export async function getGoogleClientForUser(orgId: string, userId: string) {
  const conn = await getConnection(orgId, userId)
  if (!conn || conn.status !== 'active' || !conn.refresh_token) throw new GoogleNotConnectedError()
  const client = oauthClient()
  client.setCredentials({
    access_token: conn.access_token || undefined,
    refresh_token: conn.refresh_token,
    expiry_date: conn.token_expiry ? new Date(conn.token_expiry).getTime() : undefined,
  })
  client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      const exp = tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null
      void updateAccessToken(orgId, userId, tokens.access_token, exp).catch(() => {})
    }
  })
  return client
}

/** Mark a connection invalid (called by service wrappers on auth errors). */
export async function invalidateConnection(orgId: string, userId: string) {
  await markInvalid(orgId, userId)
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/google/client.ts
git commit -m "feat(google): per-user authed client + auth-error helpers"
```

---

## Task 8: Calendar wrapper

**Files:**
- Create: `lib/google/calendar.ts`

- [ ] **Step 1: Implement `lib/google/calendar.ts`**

```ts
import { google } from 'googleapis'
import { getGoogleClientForUser, isGoogleAuthError, invalidateConnection, GoogleNotConnectedError } from '@/lib/google/client'

const DEFAULT_TZ = 'Asia/Jerusalem'

export async function createCalendarEvent(args: {
  orgId: string
  userId: string
  summary: string
  description?: string
  start: Date
  end: Date
  attendees?: string[]
  timeZone?: string
}): Promise<{ eventId: string; htmlLink: string }> {
  const auth = await getGoogleClientForUser(args.orgId, args.userId)
  const calendar = google.calendar({ version: 'v3', auth })
  const tz = args.timeZone || DEFAULT_TZ
  try {
    const res = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: args.summary,
        description: args.description,
        start: { dateTime: args.start.toISOString(), timeZone: tz },
        end: { dateTime: args.end.toISOString(), timeZone: tz },
        attendees: args.attendees?.map((email) => ({ email })),
      },
    })
    return { eventId: res.data.id!, htmlLink: res.data.htmlLink || '' }
  } catch (err) {
    if (isGoogleAuthError(err)) {
      await invalidateConnection(args.orgId, args.userId)
      throw new GoogleNotConnectedError()
    }
    throw err
  }
}

export async function updateCalendarEvent(args: {
  orgId: string
  userId: string
  eventId: string
  summary?: string
  description?: string
  start?: Date
  end?: Date
  timeZone?: string
}): Promise<{ eventId: string }> {
  const auth = await getGoogleClientForUser(args.orgId, args.userId)
  const calendar = google.calendar({ version: 'v3', auth })
  const tz = args.timeZone || DEFAULT_TZ
  try {
    const res = await calendar.events.patch({
      calendarId: 'primary',
      eventId: args.eventId,
      requestBody: {
        summary: args.summary,
        description: args.description,
        ...(args.start ? { start: { dateTime: args.start.toISOString(), timeZone: tz } } : {}),
        ...(args.end ? { end: { dateTime: args.end.toISOString(), timeZone: tz } } : {}),
      },
    })
    return { eventId: res.data.id! }
  } catch (err) {
    if (isGoogleAuthError(err)) {
      await invalidateConnection(args.orgId, args.userId)
      throw new GoogleNotConnectedError()
    }
    throw err
  }
}
```

- [ ] **Step 2: Type-check + commit**

Run: `npx tsc --noEmit` (expect exit 0)

```bash
git add lib/google/calendar.ts
git commit -m "feat(google): calendar create/update wrappers"
```

---

## Task 9: Gmail wrapper + MIME builder

**Files:**
- Create: `lib/google/gmail.ts`
- Verify: `/tmp/verify-mime.mjs`

- [ ] **Step 1: Write the failing MIME verify script**

Create `/tmp/verify-mime.mjs`:

```js
const mod = await import('file:///Users/idosegev/Downloads/TriRoars/rent360/lib/google/gmail.ts')
const raw = mod.__buildMimeForTest({ to: ['a@b.com'], subject: 'שלום', text: 'תוכן בעברית' })
if (!raw.includes('To: a@b.com')) throw new Error('missing To')
if (!raw.includes('=?UTF-8?B?')) throw new Error('subject not UTF-8 encoded')
const b64 = Buffer.from('תוכן בעברית', 'utf8').toString('base64')
if (!raw.includes(b64)) throw new Error('body not base64 UTF-8')
console.log('OK mime')
```

- [ ] **Step 2: Run it — expect failure**

Run: `npx -y tsx /tmp/verify-mime.mjs`
Expected: FAIL — module/function missing.

- [ ] **Step 3: Implement `lib/google/gmail.ts`**

```ts
import { google } from 'googleapis'
import { getGoogleClientForUser, isGoogleAuthError, invalidateConnection, GoogleNotConnectedError } from '@/lib/google/client'

function buildMime(args: { to: string[]; subject: string; text: string; html?: string }): string {
  const subjectEnc = `=?UTF-8?B?${Buffer.from(args.subject, 'utf8').toString('base64')}?=`
  const base = [`To: ${args.to.join(', ')}`, `Subject: ${subjectEnc}`, 'MIME-Version: 1.0']
  if (args.html) {
    const boundary = 'r360boundary'
    base.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
    const body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(args.text, 'utf8').toString('base64'),
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(args.html, 'utf8').toString('base64'),
      '',
      `--${boundary}--`,
    ].join('\r\n')
    return base.join('\r\n') + '\r\n\r\n' + body
  }
  base.push('Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64')
  return base.join('\r\n') + '\r\n\r\n' + Buffer.from(args.text, 'utf8').toString('base64')
}

/** Exported only for the MIME verify script. */
export const __buildMimeForTest = buildMime

export async function sendGmail(args: {
  orgId: string
  userId: string
  to: string | string[]
  subject: string
  text: string
  html?: string
}): Promise<{ messageId: string }> {
  const auth = await getGoogleClientForUser(args.orgId, args.userId)
  const gmail = google.gmail({ version: 'v1', auth })
  const to = Array.isArray(args.to) ? args.to : [args.to]
  const raw = Buffer.from(buildMime({ to, subject: args.subject, text: args.text, html: args.html }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  try {
    const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
    return { messageId: res.data.id! }
  } catch (err) {
    if (isGoogleAuthError(err)) {
      await invalidateConnection(args.orgId, args.userId)
      throw new GoogleNotConnectedError()
    }
    throw err
  }
}
```

- [ ] **Step 4: Run the verify script — expect PASS**

Run: `npx -y tsx /tmp/verify-mime.mjs`
Expected: `OK mime`

- [ ] **Step 5: Commit**

```bash
git add lib/google/gmail.ts
git commit -m "feat(google): gmail send wrapper + UTF-8 MIME builder"
```

---

## Task 10: OAuth routes + middleware allowlist

**Files:**
- Create: `app/api/google/connect/route.ts`, `app/api/google/callback/route.ts`, `app/api/google/status/route.ts`, `app/api/google/disconnect/route.ts`
- Modify: `middleware.ts:32-39`

- [ ] **Step 1: `app/api/google/connect/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { nanoid } from 'nanoid'
import { requireOrg } from '@/lib/api/org-context'
import { consentUrl, signState } from '@/lib/google/oauth'
import { isGoogleConfigured } from '@/lib/google/config'

export async function GET() {
  if (!isGoogleConfigured()) {
    return NextResponse.json({ error: 'google_not_configured' }, { status: 500 })
  }
  const ctx = await requireOrg()
  const base = process.env.APP_BASE_URL || 'https://rent360-vert.vercel.app'
  if (!ctx) return NextResponse.redirect(new URL('/auth/login', base))
  const nonce = nanoid()
  cookies().set('g_oauth_nonce', nonce, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' })
  const state = signState({ uid: ctx.uid, orgId: ctx.orgId, nonce })
  return NextResponse.redirect(consentUrl(state))
}
```

- [ ] **Step 2: `app/api/google/callback/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { google } from 'googleapis'
import { verifyState, exchangeCode, oauthClient } from '@/lib/google/oauth'
import { upsertConnection } from '@/lib/google/connections'

export async function GET(req: NextRequest) {
  const base = process.env.APP_BASE_URL || 'https://rent360-vert.vercel.app'
  const fail = (reason: string) => NextResponse.redirect(new URL(`/admin?google=error&reason=${reason}`, base))
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) return fail('missing_params')
  const parsed = verifyState(state)
  if (!parsed) return fail('bad_state')
  const nonce = cookies().get('g_oauth_nonce')?.value
  if (!nonce || nonce !== parsed.nonce) return fail('nonce_mismatch')
  try {
    const tokens = await exchangeCode(code)
    const client = oauthClient()
    client.setCredentials(tokens)
    const oauth2 = google.oauth2({ version: 'v2', auth: client })
    const me = await oauth2.userinfo.get()
    await upsertConnection({
      orgId: parsed.orgId,
      userId: parsed.uid,
      googleEmail: me.data.email || null,
      accessToken: tokens.access_token || null,
      refreshToken: tokens.refresh_token || null,
      scopes: tokens.scope ? tokens.scope.split(' ') : null,
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    })
    cookies().delete('g_oauth_nonce')
    return NextResponse.redirect(new URL('/admin?google=connected', base))
  } catch {
    return fail('exchange_failed')
  }
}
```

- [ ] **Step 3: `app/api/google/status/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { requireOrg } from '@/lib/api/org-context'
import { getConnection } from '@/lib/google/connections'

export async function GET() {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const conn = await getConnection(ctx.orgId, ctx.uid)
  return NextResponse.json({
    connected: !!conn && conn.status === 'active',
    email: conn?.google_email ?? null,
    status: conn?.status ?? null,
    scopes: conn?.scopes ?? [],
  })
}
```

- [ ] **Step 4: `app/api/google/disconnect/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { requireOrg } from '@/lib/api/org-context'
import { getConnection, deleteConnection } from '@/lib/google/connections'

export async function POST() {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const conn = await getConnection(ctx.orgId, ctx.uid)
  if (conn?.refresh_token) {
    await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(conn.refresh_token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).catch(() => {})
  }
  await deleteConnection(ctx.orgId, ctx.uid)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 5: Allowlist the callback in `middleware.ts`**

In `middleware.ts`, change the `isCronAuthed` block's closing and add a Google clause. Replace lines 32-39:

```ts
  const isCronAuthed =
    pathname === '/api/v1/matches/backfill' ||
    pathname === '/api/v1/neighborhoods/backfill' ||
    pathname === '/api/v1/embeddings/backfill-renters' ||
    pathname === '/api/v1/properties/audit-amenities' ||
    pathname === '/api/v1/outreach/batch-pending' ||
    pathname === '/api/v1/cron/callback-reminders' ||
    pathname === '/api/v1/auth/seed-team'

  // Google OAuth callback — Google redirects here; identity comes from the signed `state`,
  // so it must be reachable without our session middleware blocking it.
  const isGoogleOAuthCallback = pathname === '/api/google/callback'
```

Then add `isGoogleOAuthCallback ||` to the `if (...)` allowlist condition (after `isCronAuthed ||`).

- [ ] **Step 6: Type-check + build**

Run: `npx tsc --noEmit` (expect exit 0)
Run: `npm run build` (expect success — routes compile)

- [ ] **Step 7: Commit**

```bash
git add app/api/google middleware.ts
git commit -m "feat(google): OAuth connect/callback/status/disconnect routes + middleware allowlist"
```

- [ ] **Step 8: Manual OAuth verification (real account)**

With dev creds in `.env.local` and `GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback` registered in the console:
1. `npm run dev`, log in, visit `http://localhost:3000/api/google/connect`.
2. Pass the "unverified app" warning (Advanced → proceed), grant Calendar + Gmail.
3. Land on `/admin?google=connected`.
4. Verify the row via `mcp__supabase__execute_sql`:
   ```sql
   select user_id, google_email, status, scopes,
          (refresh_token like '%:%:%') as looks_encrypted
   from google_connections;
   ```
   Expected: one row, `status=active`, `looks_encrypted=true`, scopes include calendar.events + gmail.send.

---

## Task 11: Action endpoints (manual event/email) + thread assignment

**Files:**
- Create: `app/api/google/calendar/event/route.ts`, `app/api/google/gmail/send/route.ts`, `app/api/v1/inbox/threads/[id]/assign/route.ts`

- [ ] **Step 1: `app/api/google/calendar/event/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrg } from '@/lib/api/org-context'
import { createCalendarEvent } from '@/lib/google/calendar'
import { GoogleNotConnectedError } from '@/lib/google/client'

const Body = z.object({
  summary: z.string().min(1),
  description: z.string().optional(),
  start: z.string().datetime(),   // ISO 8601 (UTC) from the client
  end: z.string().datetime(),
  attendees: z.array(z.string().email()).optional(),
})

export async function POST(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  try {
    const res = await createCalendarEvent({
      orgId: ctx.orgId,
      userId: ctx.uid,
      summary: parsed.data.summary,
      description: parsed.data.description,
      start: new Date(parsed.data.start),
      end: new Date(parsed.data.end),
      attendees: parsed.data.attendees,
    })
    return NextResponse.json({ ok: true, ...res })
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) {
      return NextResponse.json({ error: 'google_not_connected', message: 'חבר חשבון Google קודם' }, { status: 428 })
    }
    return NextResponse.json({ error: 'calendar_failed' }, { status: 500 })
  }
}
```

- [ ] **Step 2: `app/api/google/gmail/send/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrg } from '@/lib/api/org-context'
import { sendGmail } from '@/lib/google/gmail'
import { GoogleNotConnectedError } from '@/lib/google/client'

const Body = z.object({
  to: z.union([z.string().email(), z.array(z.string().email()).min(1)]),
  subject: z.string().min(1),
  text: z.string().min(1),
  html: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  try {
    const res = await sendGmail({ orgId: ctx.orgId, userId: ctx.uid, ...parsed.data })
    return NextResponse.json({ ok: true, ...res })
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) {
      return NextResponse.json({ error: 'google_not_connected', message: 'חבר חשבון Google קודם' }, { status: 428 })
    }
    return NextResponse.json({ error: 'gmail_failed' }, { status: 500 })
  }
}
```

- [ ] **Step 3: `app/api/v1/inbox/threads/[id]/assign/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrg } from '@/lib/api/org-context'

const Body = z.object({ user_id: z.string().uuid().nullable() })

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  // If assigning, the target user must be in the same org.
  if (parsed.data.user_id) {
    const { data: u } = await ctx.sb.from('users').select('id').eq('id', parsed.data.user_id).eq('org_id', ctx.orgId).maybeSingle()
    if (!u) return NextResponse.json({ error: 'user_not_in_org' }, { status: 400 })
  }
  const { error } = await ctx.sb
    .from('threads')
    .update({ assigned_user_id: parsed.data.user_id })
    .eq('id', params.id)
    .eq('org_id', ctx.orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Type-check + build + commit**

Run: `npx tsc --noEmit` (expect exit 0); `npm run build` (expect success)

```bash
git add app/api/google/calendar app/api/google/gmail app/api/v1/inbox/threads/[id]/assign
git commit -m "feat(google): manual calendar/email endpoints + thread assignment"
```

- [ ] **Step 5: Manual verification (connected account from Task 10)**

```bash
# In the browser devtools (logged-in session), or with the sb-access-token cookie:
curl -X POST http://localhost:3000/api/google/calendar/event -H 'Content-Type: application/json' \
  --cookie "sb-access-token=<token>" \
  -d '{"summary":"בדיקת רנט360","start":"2026-06-15T13:00:00.000Z","end":"2026-06-15T13:30:00.000Z"}'
# Expected: {"ok":true,"eventId":"...","htmlLink":"..."} and the event appears on the account's calendar.

curl -X POST http://localhost:3000/api/google/gmail/send -H 'Content-Type: application/json' \
  --cookie "sb-access-token=<token>" \
  -d '{"to":"triroars@gmail.com","subject":"בדיקה מרנט360","text":"שלום, זו בדיקה."}'
# Expected: {"ok":true,"messageId":"..."} and the Hebrew email arrives intact.
```

---

## Task 12: UI — connection card (/admin) + thread actions (/inbox/[id])

**Files:**
- Create: `components/google/GoogleConnectionCard.tsx`, `components/google/ThreadGoogleActions.tsx`
- Modify: `app/admin/page.tsx`, `app/inbox/[id]/page.tsx`

- [ ] **Step 1: `components/google/GoogleConnectionCard.tsx`**

```tsx
'use client'
import { useEffect, useState } from 'react'

type Status = { connected: boolean; email: string | null; status: string | null; scopes: string[] }

export function GoogleConnectionCard() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(false)

  async function refresh() {
    const r = await fetch('/api/google/status')
    if (r.ok) setStatus(await r.json())
  }
  useEffect(() => { void refresh() }, [])

  async function disconnect() {
    setLoading(true)
    await fetch('/api/google/disconnect', { method: 'POST' }).catch(() => {})
    setLoading(false)
    void refresh()
  }

  return (
    <div className="rounded-xl border p-4" dir="rtl">
      <h3 className="font-bold mb-2">חיבור Google (יומן + אימייל)</h3>
      {status?.connected ? (
        <div className="space-y-2">
          <p className="text-sm text-green-700">מחובר: {status.email}</p>
          <button onClick={disconnect} disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-sm">נתק</button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-gray-600">חבר את חשבון ה-Google שלך כדי ליצור אירועי יומן ולשלוח מיילים בשמך.</p>
          <a href="/api/google/connect"
            className="inline-block px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm">חבר חשבון Google</a>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Mount it in `app/admin/page.tsx`**

Import at the top of `app/admin/page.tsx`:
```tsx
import { GoogleConnectionCard } from '@/components/google/GoogleConnectionCard'
```
Render `<GoogleConnectionCard />` inside the page's main content container (near the other settings cards). If `app/admin/page.tsx` is a server component, the card is a `'use client'` component and can be rendered directly.

- [ ] **Step 3: `components/google/ThreadGoogleActions.tsx`**

```tsx
'use client'
import { useState } from 'react'

type TeamUser = { id: string; name: string | null }

export function ThreadGoogleActions(props: {
  threadId: string
  assignedUserId: string | null
  team: TeamUser[]
  contactEmail?: string | null
}) {
  const [assigned, setAssigned] = useState(props.assignedUserId)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function assign(userId: string | null) {
    setBusy(true)
    const r = await fetch(`/api/v1/inbox/threads/${props.threadId}/assign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    })
    setBusy(false)
    if (r.ok) setAssigned(userId)
  }

  async function addEvent() {
    const summary = prompt('כותרת האירוע:')
    if (!summary) return
    const when = prompt('מתי? (YYYY-MM-DDTHH:MM, שעון ישראל):')
    if (!when) return
    const start = new Date(when)
    const end = new Date(start.getTime() + 30 * 60000)
    setBusy(true)
    const r = await fetch('/api/google/calendar/event', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary, start: start.toISOString(), end: end.toISOString() }),
    })
    setBusy(false)
    setMsg(r.ok ? 'האירוע נוצר ביומן' : (await r.json()).message || 'שגיאה ביצירת האירוע')
  }

  async function sendEmail() {
    const to = prompt('נמען:', props.contactEmail || '')
    if (!to) return
    const subject = prompt('נושא:')
    if (!subject) return
    const text = prompt('תוכן:')
    if (!text) return
    setBusy(true)
    const r = await fetch('/api/google/gmail/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, text }),
    })
    setBusy(false)
    setMsg(r.ok ? 'המייל נשלח' : (await r.json()).message || 'שגיאה בשליחת המייל')
  }

  return (
    <div className="flex flex-wrap items-center gap-2" dir="rtl">
      <select value={assigned ?? ''} disabled={busy}
        onChange={(e) => assign(e.target.value || null)}
        className="text-sm border rounded-lg px-2 py-1">
        <option value="">לא משויך</option>
        {props.team.map((u) => <option key={u.id} value={u.id}>{u.name || u.id}</option>)}
      </select>
      <button onClick={addEvent} disabled={busy} className="text-sm px-2 py-1 rounded-lg border">הוסף ליומן</button>
      <button onClick={sendEmail} disabled={busy} className="text-sm px-2 py-1 rounded-lg border">שלח מייל</button>
      {msg && <span className="text-xs text-gray-600">{msg}</span>}
    </div>
  )
}
```

- [ ] **Step 4: Mount it in `app/inbox/[id]/page.tsx`**

In `app/inbox/[id]/page.tsx`, fetch the team list (`users` for the org: `id, name`) and the thread's `assigned_user_id` (already loaded with the thread, or add to the select), then render near the thread header:
```tsx
import { ThreadGoogleActions } from '@/components/google/ThreadGoogleActions'
// ...
<ThreadGoogleActions
  threadId={thread.id}
  assignedUserId={thread.assigned_user_id ?? null}
  team={team}                       // [{id, name}] for the org
  contactEmail={property?.contact_email ?? null}
/>
```
If the page's thread query doesn't already select `assigned_user_id`, add it to the select list. Load `team` via `supabaseService().from('users').select('id, name').eq('org_id', orgId).eq('is_active', true)`.

- [ ] **Step 5: Build + commit**

Run: `npm run build` (expect success)

```bash
git add components/google app/admin/page.tsx "app/inbox/[id]/page.tsx"
git commit -m "feat(google): connection card in /admin + per-thread assign/calendar/email actions"
```

- [ ] **Step 6: Manual UI verification**

1. `/admin` shows the card; "חבר חשבון Google" → connect → card shows "מחובר: <email>".
2. Open a thread in `/inbox/<id>`; assign an owner (persists on reload); "הוסף ליומן" creates an event; "שלח מייל" sends. With a disconnected user, both show "חבר חשבון Google קודם".

---

## Task 13: Automatic callback → calendar event

**Files:**
- Create: `lib/google/auto-callback-event.ts`
- Modify: `lib/ai/landlord-outreach/tools.ts` (`recordIntent`)

- [ ] **Step 1: `lib/google/auto-callback-event.ts`**

```ts
import { supabaseService } from '@/lib/supabase'
import { createCalendarEvent, updateCalendarEvent } from '@/lib/google/calendar'

/** Parse an Israel wall-clock string ("YYYY-MM-DD" or "YYYY-MM-DDTHH:MM") into a UTC Date. */
export function israelLocalToDate(local: string): Date {
  const [datePart, timePart = '00:00'] = local.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm] = timePart.split(':').map(Number)
  const guess = new Date(Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0))
  const back = new Date(guess.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }))
  const offsetMs = guess.getTime() - back.getTime()
  return new Date(guess.getTime() + offsetMs)
}

async function resolveOwner(orgId: string, threadId: string): Promise<string | null> {
  const sb = supabaseService()
  const { data: thread } = await sb.from('threads').select('assigned_user_id').eq('id', threadId).maybeSingle()
  if (thread?.assigned_user_id) return thread.assigned_user_id
  const { data: settings } = await sb.from('settings').select('default_calendar_user_id').eq('org_id', orgId).maybeSingle()
  return settings?.default_calendar_user_id ?? null
}

/**
 * Best-effort: create/update a calendar event for a callback. Never throws — a Google failure
 * must not block intent recording or the conversation flow.
 */
export async function syncCallbackEvent(args: {
  orgId: string
  threadId: string
  propertyId: string | null
  callbackAt: string                 // Israel local "YYYY-MM-DD[THH:MM]"
}): Promise<void> {
  try {
    const userId = await resolveOwner(args.orgId, args.threadId)
    if (!userId) return
    const sb = supabaseService()
    const { data: thread } = await sb.from('threads').select('tags, phone').eq('id', args.threadId).maybeSingle()
    const tags = (thread?.tags && typeof thread.tags === 'object' ? thread.tags : {}) as Record<string, unknown>
    let title = 'חזרה ללקוח'
    if (args.propertyId) {
      const { data: p } = await sb.from('properties').select('contact_name, title').eq('id', args.propertyId).maybeSingle()
      title = `חזרה ל${p?.contact_name || p?.title || thread?.phone || 'לקוח'}`
    }
    const start = israelLocalToDate(args.callbackAt)
    const end = new Date(start.getTime() + 30 * 60000)
    const base = process.env.APP_BASE_URL || 'https://rent360-vert.vercel.app'
    const description = `שיחת חזרה מתוזמנת אוטומטית ע"י רנט360.\n${base}/inbox/${args.threadId}`
    const existingId = typeof tags.calendar_event_id === 'string' ? tags.calendar_event_id : null
    if (existingId) {
      await updateCalendarEvent({ orgId: args.orgId, userId, eventId: existingId, summary: title, description, start, end })
    } else {
      const res = await createCalendarEvent({ orgId: args.orgId, userId, summary: title, description, start, end })
      tags.calendar_event_id = res.eventId
      await sb.from('threads').update({ tags }).eq('id', args.threadId)
    }
  } catch {
    /* best-effort — never block the caller */
  }
}
```

- [ ] **Step 2: Wire into `recordIntent` in `lib/ai/landlord-outreach/tools.ts`**

At the top of `lib/ai/landlord-outreach/tools.ts`, add:
```ts
import { syncCallbackEvent } from '@/lib/google/auto-callback-event'
```
In `recordIntent`, immediately before `return { ok: true, intent: args.intent }`, add:
```ts
  // Best-effort: mirror a scheduled callback into the responsible user's Google Calendar.
  if (args.intent === 'callback_later' && args.callback_at) {
    await syncCallbackEvent({
      orgId: ctx.orgId,
      threadId: ctx.threadId,
      propertyId: ctx.propertyId,
      callbackAt: args.callback_at,
    })
  }
```

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit` (expect exit 0); `npm run build` (expect success)

- [ ] **Step 4: Manual verification**

```sql
-- ensure a thread is assigned to a connected user (or rely on settings.default_calendar_user_id)
update threads set assigned_user_id = (select id from users where lower(email)='shay20036@gmail.com')
where id = '<test-thread-id>';
```
Then, in a dev conversation, have the agent record `callback_later` with a `callback_at` (e.g. "מחר ב-16:00"). Expected: an event appears on the owner's calendar at that Israel-local time, and `threads.tags.calendar_event_id` is set. Re-trigger with a new time → the same event is updated, not duplicated.

- [ ] **Step 5: Commit**

```bash
git add lib/google/auto-callback-event.ts lib/ai/landlord-outreach/tools.ts
git commit -m "feat(google): auto-mirror callback reminders into the owner's calendar"
```

---

## Task 14: End-to-end verification + deploy

**Files:** none (verification + ops)

- [ ] **Step 1: Full type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 2: Clean up temp verify scripts**

Run: `rm -f /tmp/verify-secretbox.mjs /tmp/verify-state.mjs /tmp/verify-mime.mjs`

- [ ] **Step 3: Set prod env vars in Vercel**

Set on the `rent360admin` project (deploy is manual — memory `project_vercel_deploy`):
```bash
npx vercel env add GOOGLE_CLIENT_ID production
npx vercel env add GOOGLE_CLIENT_SECRET production
npx vercel env add GOOGLE_REDIRECT_URI production   # https://rent360-vert.vercel.app/api/google/callback
npx vercel env add GOOGLE_TOKEN_ENC_KEY production
```

- [ ] **Step 4: Console check**

Confirm in Google Console: Authorized redirect URIs include the prod + localhost callbacks; consent screen User type = External; (no Test Users needed — published).

- [ ] **Step 5: Deploy + smoke test**

Run: `npx vercel --prod`
Then on prod: connect a Google account, create a calendar event and send an email from a thread; record a callback and confirm the auto event.

- [ ] **Step 6: Merge the branch**

Use the `superpowers:finishing-a-development-branch` skill to open a PR / merge `feature/google-integration` into `main`.

---

## Self-review notes

- **Spec coverage:** account model (per-user → `google_connections` keyed on org+user, Tasks 2/6); OAuth direct flow (Tasks 5/10); token encryption (Task 3 + connections); googleapis (Tasks 8/9); Calendar create + Gmail send manual (Task 11/12); auto callback routing by `assigned_user_id`→default (Task 13); redirect URIs + Test-Users/verification gotcha (Task 10/14 + spec); env vars (Task 1/14); middleware allowlist (Task 10); error handling `GoogleNotConnectedError`/`markInvalid` (Tasks 7-9, 11). Auto email correctly **absent** (deferred to v2 per spec).
- **Type consistency:** `getGoogleClientForUser`, `createCalendarEvent`/`updateCalendarEvent`, `sendGmail`, `GoogleNotConnectedError`, `isGoogleAuthError`, `invalidateConnection`, `getConnection`/`upsertConnection`/`updateAccessToken`/`markInvalid`/`deleteConnection`, `signState`/`verifyState`/`consentUrl`/`exchangeCode`, `syncCallbackEvent`/`israelLocalToDate` are defined once and referenced consistently.
- **No placeholders:** every code step contains full code; verification steps give exact commands + expected output.
