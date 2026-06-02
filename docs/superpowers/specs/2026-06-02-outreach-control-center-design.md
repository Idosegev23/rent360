# Outreach Control Center — Design (lean v1)

Date: 2026-06-02 · Branch: `feature/outreach-control-center`

## Goal

One admin screen (`/outreach`) to send WhatsApp from two existing engines, with anti-flood
governance and spam-law compliance baked in:

1. **Landlord recruitment** — pitch Rent 360 to **unapproved** property owners so they approve brokerage.
2. **Renter recommendations** — send renters their best **new, high-quality** apartment match.

Both individually (manual) and as a reviewed batch ("list"), "according to the limits".

## What already exists (reuse, do not rebuild)

- Engines: `lib/outreach/dispatcher.ts` (`dispatchInitialOutreach`) and `lib/outreach/renter-alert.ts`
  (`dispatchRenterMatchAlert`). Both: personalization, dedup, suppression check, template-approval gate.
- Individual send endpoints: `POST /api/v1/outreach/send-initial` (landlord, wired to PropertyCard button),
  `POST /api/v1/outreach/notify-renter` (renter, no UI yet).
- Batch crons: `POST /api/v1/outreach/batch-pending` (landlord), `notify-renters-pending` (renter) — CRON_SECRET auth.
- Opt-out / suppression: `lib/outreach/suppression.ts` — `whatsapp_suppression` table, `recordOptOut`,
  `isSuppressed`, hard stop-word + button + AI-tool opt-out paths (already wired in the webhook).
- Templates at Meta: `landlord_outreach_v2_basic/rich` APPROVED; `renter_match_alert_v1` **PENDING**.
- `matches` table already stores `score`, `reasons`, `breakdown`, `disqualifying_reasons` (jsonb).

## Governance model (the core requirement: avoid flooding)

Two layers:

| Rule | Automatic / batch | Manual single send |
|------|------------------|--------------------|
| Daily cap (shared, default 30; manual ramp later) | enforced (stop) | **bypass** — show indicator only |
| Per-renter: ≤1 recommendation/day (best new match) | enforced | bypass — show indicator |
| Warm-up volume (30/day, +20/week — manual env bump for now) | enforced | bypass |
| **Opt-out / suppression** | enforced | **NEVER bypassed (legal)** |
| Unapproved template | blocked | blocked (Meta rejects anyway) |

- **Renter frequency = novelty-driven, not a timer.** Only matches with `renter_notified_at IS NULL` and
  `score ≥ threshold` are eligible; per renter at most the single best new match per day. A renter can hear
  about a new hot listing the day it lands, but is never bombarded.
- **Indicator everywhere:** per-recipient badge `📩 got X (7d) · Y today` (counted from `messages`,
  direction=out) next to every send control + queue row; global `sent today N / cap` at the top.
- Transparency to renter is wanted: the match page shows **% fit, ✓ what matches, ✗ what's missing** explicitly.

## Architecture

`/outreach` page (auth via existing middleware), nav item "שליחה". Three tabs, one shared queue component:

- `OutreachQueue mode="landlord" | "renter"` — same table/select/send-batch/indicator; data source + columns differ.
- `SuppressionManager` — blocklist view + paste-import + remove.
- `LimitsPanel` — live counters (sent today/cap, opt-out rate). (Meta tier/quality display + auto circuit-breaker deferred.)

### New endpoints (cookie-auth admin, same pattern as notify-renter)

- `GET  /api/v1/outreach/landlord-queue` — eligible unapproved candidates + filters (city, hasImages, date) + counters.
- `POST /api/v1/outreach/landlord-send-batch` — `{ propertyIds }` → loop `dispatchInitialOutreach`, cap + jitter, per-row results.
- `GET  /api/v1/outreach/renter-queue` — eligible matches, **top-1 per renter**, score≥threshold, exclusions + counters.
- `POST /api/v1/outreach/renter-send-batch` — `{ matchIds }` → loop `dispatchRenterMatchAlert`, cap + per-renter/day + jitter.
- `GET/POST/DELETE /api/v1/outreach/suppression` — list / paste-import (source='manual', dedup) / remove.

Manual single send reuses existing `send-initial` / `notify-renter` (cap-free dispatchers = the manual override;
suppression + template gate still apply inside them).

### Eligibility

**Landlord queue:** org match · `initial_message_sent=false` · `outreach_blocked=false` ·
`contact_phone`/`contact_name` non-empty · **NOT in `approved_properties`** · **phone NOT in `whatsapp_suppression`**.
Optional filters: city, created_at range (the cron's hard `2026-05-13` cutoff becomes an optional filter), hasImages.
SQL filter is a coarse upper bound; dispatcher still skips bad name/street/rooms → reported per-row.

**Renter queue:** `matches` with `renter_notified_at IS NULL` · `is_disqualified=false` · `score ≥ threshold` ·
renter has phone · phone NOT suppressed · property has image+rooms+price+city · **top-1 per renter** by score.

### Match-aware share page (renter transparency)

- Migration: add nullable `renter_id`, `match_id` to `property_shares` + adjusted unique index
  (per-property when renter_id null; per-property+renter when set).
- `renter-alert.ts` mints/finds a renter-linked share token (instead of property-only). **Template URL stays `/share/`** — pending template untouched.
- `app/share/[token]` renders a "ההתאמה שלך" block when the token row has a `renter_id`: % fit (from `score`),
  ✓ matches (`reasons`), ✗ what's missing (`breakdown` / `disqualifying_reasons`). Generic property view unchanged otherwise.

### DB changes (minimal)

1. `property_shares`: `+ renter_id uuid null`, `+ match_id uuid null`, adjusted unique index.
2. Index `messages(org_id, thread_id, created_at)` for the indicator badge.
3. Governance values from env for v1 (`OUTREACH_DAILY_CAP`, `RENTER_ALERT_MIN_SCORE`, new `OUTREACH_JITTER_*`,
   `RENTER_PER_DAY_CAP=1`). `settings`-table editability deferred.

## Error handling

Reuse existing result codes: `TEMPLATE_NOT_APPROVED` → renter tab shows a banner ("התבנית ממתינה לאישור Meta"),
`SUPPRESSED`, `ALREADY_SENT`/`ALREADY_NOTIFIED`, `META_SEND_FAILED`, `daily_cap_hit`. Batch returns a per-row report
(`sent` / `skipped: reason`). Manual batch capped per click (~30–40 + jitter) to stay within Vercel function timeout.

## Verification (no test runner — manual)

- Seed a test property + renter with my own phone → individual send → confirm WhatsApp receipt + `messages` row +
  dedup stamp + indicator increments + link opens match page with the ✓/✗ breakdown.
- Exclusions: approved property absent from landlord queue; suppressed phone absent from both; paste-import a number → filtered;
  opt-out a number → leaves queue + blocked even on manual send.
- Caps: low daily cap → batch stops at cap; second auto-send to same renter same day skipped; manual override → sends with a warning.

## Deferred (explicitly out of v1, to keep it simple)

Auto-ramp scheduler · Graph-API quality/tier polling + automatic circuit-breaker · settings editable from UI · CSV upload.

## Known constraints at build time

- Renter live sends are blocked until Meta approves `renter_match_alert_v1` (UI + endpoints built and ready meanwhile).
- Production (Vercel `rent360admin`) must hold the same permanent WhatsApp token now in `.env.local`.
