# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Next.js dev server
npm run build    # production build
npm start        # serve built app
npm run lint     # eslint (extends next + next/core-web-vitals)
```

There is no test runner configured — `npm test` is a placeholder that exits with an error. Don't claim tests pass; verify behavior in the browser or via API calls.

Required env vars (see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`, `APP_BASE_URL`, `OPENAI_API_KEY`.

WhatsApp transport is **mid-migration from GreenAPI to Meta Cloud API**. New code should target Meta:
- Meta vars (placeholders until the number is verified in WhatsApp Manager): `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_BUSINESS_ACCOUNT_ID`, `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_APP_SECRET`, `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
- Legacy GreenAPI vars (`GREENAPI_INSTANCE_ID`, `GREENAPI_API_TOKEN_INSTANCE`) still exist in the krayot-rental outreach path; remove from rent360 once Meta is live.
- Admin alerts: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ADMIN_CHAT_ID` (the chat that receives handoff / urgent notifications from the AI conversation agent).

If `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE` are missing at runtime, the external POST APIs return a "demo" response (`{ status: 'demo', accepted: true }`) instead of writing — keep this fallback intact when editing those handlers.

## Architecture

Next.js 14 App Router, TypeScript strict, Tailwind, Supabase (Postgres + Auth + Storage). Path alias `@/*` → repo root. Hebrew RTL UI, mobile-first.

### Multi-tenancy is the spine of every API handler

Every row that belongs to a tenant has an `org_id`. There are **two distinct auth paths** and handlers must pick the right one:

1. **Browser/session requests** — read the `sb-access-token` cookie, decode it with `getUserIdFromSupabaseCookie()` to get `auth.uid()`, then look up `users.org_id` via `supabaseService()`. This is what UI-facing `GET` routes do.
2. **External system POSTs** (`/api/v1/properties`, `/api/v1/leads`, etc.) — require `Authorization: Bearer <JWT>` and `Idempotency-Key` headers. `getOrgIdFromAuthHeader()` extracts `org_id` directly from the JWT payload. Missing either header is an immediate 401/409.

Idempotency is enforced by recording every inbound POST in `inbound_events` keyed on `(org_id, idempotency_key)`; replays return `{ status: 'duplicate' }`. Don't bypass this when adding new ingestion endpoints.

`middleware.ts` redirects unauthenticated requests to `/auth/login` based on the Supabase cookie. The allowlist (public paths) is: `/auth/*`, `/_next/*`, `/api/v1/integrations/*`, `/api/v1/health`, `/api/v1/auth/seed`. Add new public endpoints here, not by adding bypass logic in the handler.

### Two parallel Supabase clients

- `lib/supabase.ts` — `supabaseBrowser()` (anon key, browser) and `supabaseService()` (service role, server-only, bypasses RLS). Used by most legacy code and all API handlers.
- `lib/supabase/server.ts` and `lib/supabase/client.ts` — newer `@supabase/ssr` clients that respect cookies and RLS. Used by the WhatsApp leads flow.

When writing data on the server, prefer `supabaseService()` and enforce `org_id` filtering yourself in every query. RLS is also configured (`supabase/policies/rls.sql`) but service-role calls bypass it.

### Matching engines (there are two — don't conflate them)

- `lib/matching.ts` — the original lead↔property scorer used by `app/api/v1/matches`. Returns `{ score, percentage, reasons, isDisqualified, disqualifyingReasons, breakdown }`. Default weights: price 0.30, location 0.25, rooms 0.20, amenities 0.15, moveIn 0.10.
- `lib/matching/whatsapp-matcher.ts` — separate scorer for the `whatsapp_leads` table with its own weights (location 0.25, budget 0.30, rooms 0.20, amenities 0.15, availability 0.10).

**Mandatory requirements disqualify hard.** If `lead.required_fields[key] === true` and the property lacks that amenity, `isDisqualified = true` and `score = 0` regardless of percentage. Disqualified matches still appear in the response but sort to the bottom. Preserve this contract — the UI relies on `breakdown` and `disqualifyingReasons` to explain the result.

### Database schema

Migrations live in `supabase/migrations/`; RLS in `supabase/policies/rls.sql`; one Edge Function in `supabase/functions/leads-ingest`. Core tables: `organizations`, `users` (with `role` in owner/admin/agent/viewer), `api_keys`, `properties` (extended in 0002 with scraping fields — status, evacuation date, contact info, timeline, full text), `leads`, `whatsapp_leads`, `matches`, `messages`, `inbound_events`, `settings`. Property images live in the public `property-images` Supabase Storage bucket; uploads from the client write to `properties.images`.

### Property sharing flow

`app/share/[token]/` exposes a public, token-gated property view for prospects. AI-generated copy comes from `lib/ai-property-processor.ts` (OpenAI `gpt-4o-mini`, JSON response format, Hebrew prompt) with a non-AI fallback when the call fails. Keep that fallback path working — production has run without `OPENAI_API_KEY` before.

### Messaging

`lib/messaging.ts` posts to GreenAPI's WhatsApp endpoint. All sends are server-side; status is recorded in `messages`. Don't call GreenAPI from the browser.

## Conventions specific to this repo

- **Hebrew is the default UI language**; all user-facing strings, error messages, and AI prompts are in Hebrew. Code identifiers stay in English.
- **RTL-first** — be mindful when adding flex/grid layouts and icon directions.
- **`memory-bank/` is project documentation**, not code memory. Convention from `.cursorrules`: after a substantive change, update `memory-bank/activeContext.md` and `memory-bank/progress.md`. When the user asks to "update memory bank", read and refresh all six files (`projectbrief`, `productContext`, `systemPatterns`, `techContext`, `activeContext`, `progress`).
- TypeScript is strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` — array/record access often needs explicit checks.
- `supabase/functions/` is excluded from the main tsconfig — they're Deno Edge Functions and have their own runtime.
