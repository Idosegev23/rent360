# Facebook Public Onboarding (Module B) — Design

**Date:** 2026-07-14 · **Status:** Approved (build fourth). Public, outward-facing.

## Goal
One public link (for a Facebook post/ad) that lets a prospect self-onboard as either a **renter**
("מחפשים דירה") or a **landlord** ("יש לי דירה"), via a chooser landing → two short forms.

## Flow
`/join` (chooser) → `/join/renter` or `/join/landlord` → `POST /api/v1/public/onboarding` → success screen.
Org = first org by created_at (`11111111-…`, the real org — matches every other handler).

### Renter path
1. Upsert `renters` by phone (name, `source='facebook'`).
2. Record an `onboarding_submissions` row (audience='renter', created_renter_id).
3. Fire the **intake bot opener**: send approved `renter_intake_invite_v1` (skip if suppressed /
   template not approved), upsert the renter thread (`tags.audience='renter'`), record the message.
   When they tap "כן, בוא נתחיל" the webhook routes them to the WhatsApp intake bot. Wrapped so a
   send failure never fails the submission.

### Landlord path
1. Insert a `properties` lead: `org_id`, `title` (address/city), `city`, `address`, `price`,
   `contact_name`, `contact_phone`, `source='facebook_onboarding'`, `is_active=false`. It enters the
   "אשר תיווך" approval queue.
2. Record an `onboarding_submissions` row (created_property_id).
3. Best-effort Telegram admin ping (free-form, no template) that a new landlord lead arrived.

## Schema — migration `0037_onboarding_submissions.sql`
`onboarding_submissions (id, org_id, audience CHECK renter|landlord, payload jsonb, contact_name,
contact_phone, city, created_renter_id, created_property_id, status, ip, user_agent, created_at)`,
indexes on (contact_phone, created_at) + (org_id, created_at), RLS org-scoped. Audit + dedupe trail.

## API — `app/api/v1/public/onboarding/route.ts` (PUBLIC POST)
Abuse guards (no auth): honeypot field (silently ok), required-field + phone validation, per-phone
rate limit (≤5 submissions/hour via a count on onboarding_submissions), captures ip/user_agent.
Idempotent-ish: renter is upserted by phone; landlord dedupes an identical phone submission within
the last hour. Returns `{ ok, audience, renterId|propertyId, opener? }`.

## Pages (public, RTL, mobile-first)
- `app/join/page.tsx` — chooser, two large cards.
- `app/join/renter/page.tsx` — name, phone, city, budget (+ hidden honeypot). Success: "נהדר! נשלח לך
  הודעת וואטסאפ עם כמה שאלות קצרות."
- `app/join/landlord/page.tsx` — name, phone, city, address, price. Success: "תודה! ניצור קשר בהקדם."

## Middleware
Allowlist `pathname.startsWith('/join')` and `/api/v1/public/onboarding` (both public by design).

## Acceptance
1. Migration applied; table exists.
2. `/join` + both forms render publicly (no login redirect).
3. Renter submit → renter row (source='facebook') + onboarding_submissions + (if template approved)
   an intake opener sent; a human sees it in the inbox.
4. Landlord submit → properties lead (source='facebook_onboarding', is_active=false) in the approval
   queue + onboarding_submissions.
5. Honeypot-filled or >5/hr per phone → no records / 429; bad phone → 400.
