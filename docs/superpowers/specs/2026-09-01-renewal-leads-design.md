# Renewal leads — Nadlan One historical import + `/renewals` page + outreach pipeline — Design

**Date:** 2026-09-01 · **Status:** Approved (all four scope decisions confirmed by the client).

## Context (what already existed)

- **The outreach machinery is built.** `lib/outreach/dispatcher.ts` (send + thread + message +
  suppression in one place), `lib/outreach/governance.ts` (`DAILY_CAP=250`, jitter, per-recipient
  counts), `lib/outreach/suppression.ts` (opt-out), `lib/time/send-window.ts` (09:00–21:00 Israel +
  Hebcal Shabbat/חג), and `app/outreach/page.tsx` — a review-and-send queue with
  landlord/renter/suppression tabs. This design **reuses all of it** and adds no parallel copy.
- **`properties.external_id` is already the Nadlan One property id.** Measured: 9,338 of the 13,463
  exported ids match existing rows exactly (see the correction note below). rent360's external scraper is fed by the same upstream
  feed but discards the movement `תאריך` on ingest — which is why no delist date exists in the DB
  today and had to be estimated from Hebrew relative strings.
- Constraints: `properties_external_id_unique UNIQUE (external_id)` (global, not org-scoped) and
  `properties_org_external_unique UNIQUE (org_id, external_id)`. Org = `11111111-…-111111111111`.
- The nightly matcher (`/api/v1/matches/backfill`) walks **`approved_properties` only**, so imported
  rows never enter matching or fire renter alerts.
- The landlord recruitment queue filters `.or('is_active.is.null,is_active.eq.true')` — so
  `is_active=false` is sufficient to keep renewal rows out of it.

## Source data

`docs/wehouse_haifa_properties.csv` (13,463) + `docs/wehouse_haifa_movements.csv` (69,135), exported
from mls.nadlanone.co.il on 2026-09-01. Merged and scored into `docs/haifa_unified.csv` by
`scripts/` (see §6). Measured coverage:

| | |
|---|---|
| Phone | 13,463 / 13,463 (100%) |
| Delist date | 13,463 / 13,463 (100%) |
| Real mobile (05x) | 12,362 (92%) |
| Private owner (phone appears on exactly one listing) | 11,237 (83%) |
| Two phone numbers | 3,146 (23%) |
| Published 2+ times | 5,415 |
| Cities | חיפה 8,287 · קרית אתא 1,327 · קרית ביאליק 1,066 · קרית מוצקין 1,048 · נשר 875 · קרית ים 860 |

**The last movement on all 13,463 is `ירד מפרסום`** — the export is pre-filtered to listings that
never came back, so no re-listed noise.

**Known gaps, carried into the spec rather than papered over:**
1. **March 2026 has zero delists** while every other month has 550–2,500. ~1,000 leads that would
   mature in March 2027 are missing. Request a re-export for that month.
2. **The delist timestamp is a detection sweep, not the real moment.** 27,560 delist movements share
   only 344 distinct timestamps (1,213 properties at `2025-11-16T00:23:10`). 292 distinct sweep days
   over ~354 days, so the *day* is typically accurate to ±1–2 days. Column is therefore named
   `delisted_observed_at`, and no exact date ever appears in a message.

## 1. Data model

### `properties` — stays the property entity

The inbox, the AI conversation agent and `threads.property_id` all key off `properties`. Renewal
leads must have a row here or the conversational side has nothing to talk about. Upsert on
`external_id`:

- **4,125 new** → created with `source='nadlanone_renewal'`, `is_active=false`.
- **9,338 existing** → **field-level merge only**. Writable: `contact_phone` (see below), `timeline`,
  `neighborhood`/`street`/`sqm`/`floor`/`rooms`/`price` **only when currently null**, and
  `scraped_metadata.renewal_import`. Never touched: `initial_message_sent`, `outreach_blocked`,
  `is_active`, `landlord_id`, `assigned_agent_user_id`, `agreed_commission_*`, `status`.
- **~435 phone conflicts** → Nadlan One wins (its export is complete and dated 2026-09-01); the prior
  value is preserved at `scraped_metadata.renewal_import.previous_phone`.
- **~3,875 rows gain a phone they were missing.** Phone coverage across all rows carrying a Nadlan One
  id goes 6,744/12,076 (55.8%) → 14,746/16,201 (**91.0%**).

### `renewal_leads` — migration 0038, holds the campaign lifecycle

```sql
create table renewal_leads (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade,
  property_id           uuid not null references properties(id) on delete cascade,
  source                text not null default 'nadlanone',
  external_id           text not null,

  delisted_at           date not null,          -- day the listing was first seen delisted
  delisted_observed_at  timestamptz,            -- sweep timestamp; NOT the real moment (see gaps)
  first_listed_at       date,
  matures_at            date not null,          -- delisted_at + 365

  days_on_market        int,
  times_listed          int not null default 1,
  price_first           int,
  price_last            int,
  price_change_pct      numeric(5,1),

  city                  text,                   -- snapshot of the listing, not live property state
  street                text,
  segment               text not null,          -- 'private_once' | 'repeat'
  score                 int not null default 0,
  is_private_owner      boolean not null default true,
  phone_kind            text,                   -- 'mobile' | 'voip' | 'landline'
  phone_alt             text,

  status                text not null default 'pending',
                        -- v1 writes: pending | sent | skipped
                        -- reserved for later outcome tracking: replied | won | lost
  skip_reason           text,
  sent_at               timestamptz,
  thread_id             uuid references threads(id),
  message_id            uuid references messages(id),

  timeline              jsonb,                  -- full movement history for this listing
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (org_id, external_id)
);
create index renewal_leads_due_idx   on renewal_leads (org_id, status, matures_at);
create index renewal_leads_score_idx on renewal_leads (org_id, score desc);
create index renewal_leads_city_idx  on renewal_leads (org_id, city);
```

`city`/`street` are denormalized deliberately: they are immutable facts of the delisted listing at
export time, not live property state, so there is no drift to manage — and the `/renewals` browse
page filters and sorts on them across 13,463 rows without a join.

### Lead scoring (computed at import, stored in `score`)

Private owner +30 · real mobile +20 · published 2+ times +20 · rented within 60 days +15 (or +5 if
listed >180 days) · cut the price ≥3% on the way +10 · known neighborhood +5.
Result on this export: A(80+) 4,442 · B(60–79) 5,216 · C(40–59) 3,360 · D 445.

`segment = 'repeat'` when `times_listed >= 2` (5,415), else `'private_once'` (8,048).

## 2. Maturation — a date query, not a state machine

`matures_at = delisted_at + 365`, computed once at import. Maturity is then **a query on a date** —
no cron, no job, no drift, and the window can move without a migration:

- `matures_at > today+30` → **עתידי**
- `matures_at` within `[today-45, today+30]` and `status='pending'` → **מבשיל** (the send queue)
- `matures_at < today-45` → **פג**, reachable only by explicit manual filter

The window looks **forward as well as back**. The tenancy began when the listing came down, so the
renewal decision is made shortly *before* the anniversary — a purely backward window would always
arrive late. 30 days forward catches the decision while it is live; 45 days back is the grace so a
quiet stretch loses nothing.

Today (2026-09-01) that yields **259 due** — the whole of the 2026-09 bucket, matching the source
export's own "ליד פעיל עכשיו" definition. (A backward-only window would yield **0**: the earliest
`matures_at` in this dataset is 2026-09-13.) The pipeline then delivers
512 (Oct) · 1,222 (Nov) · 1,192 (Dec) · 1,139 (Jan) · 552 (Feb) · 0 (Mar,
the gap) · 934 (Apr) · 2,064 (May) · 1,854 (Jun) · 1,184 (Jul) · 2,508 (Aug) · 43 (Sep 2027) —
13,463 in total.

## 3. Outreach pipeline

New `lib/outreach/renewal-dispatcher.ts`, mirroring `dispatchInitialOutreach` but taking a `leadId`.
It **reuses** `isSuppressed`, thread upsert, the `messages` insert, `DAILY_CAP`, `sleepJitter`, and
`canSendNow`, and it keeps the existing contract of refusing to send unless the template row in
`whatsapp_templates` is `status='approved'`.

Gates evaluated before every send, each producing a `skip_reason`:

| Gate | Source |
|---|---|
| phone on the suppression list | `whatsapp_suppression` (420 rows today) |
| `properties.outreach_blocked = true` | property |
| already an approved brokerage property | `approved_properties` — **35 of the 13,463 hit this** |
| lead not `pending` | `renewal_leads.status` |
| outside 09:00–21:00 Israel, or Shabbat/חג | `canSendNow()` |
| daily template cap reached | `templatesSentToday()` vs `DAILY_CAP` |

On success: stamp `status='sent'`, `sent_at`, `thread_id`, `message_id`.

**`properties.initial_message_sent` is deliberately not flipped.** That flag means "we sent a
first-touch about a *live listing*"; conflating the two would silently corrupt the existing landlord
queue's semantics. Double-contact protection comes from the existing `recipientMessageCounts` badge,
which already counts these sends because they go through `threads`/`messages` like everything else.

**Endpoints** (session-auth, `requireAdminOrg`, same shape as the landlord routes):
- `GET  /api/v1/renewals/queue` — due leads + `{ sentToday, dailyCap, remaining }`
- `GET  /api/v1/renewals/pipeline` — server-paginated browse (50/page) + aggregates
- `POST /api/v1/renewals/send-batch` — enforces cap + `MANUAL_BATCH_MAX` + jitter
- `POST /api/v1/renewals/send-one` — single manual send, cap-free (matches `send-initial`)
- `POST /api/v1/renewals/skip` — mark a lead skipped with a reason

## 4. `/renewals` page

Standalone route, own sidebar entry with a badge showing the due count.

- **Tab "מבשילים"** (default) — the review-and-send queue, same interaction pattern as the landlord
  tab: filters, row selection, per-row preview of the exact rendered message, batch send, and a
  visible daily-cap counter. Shows the template-approval state prominently when sends are blocked.
- **Tab "הצנרת"** — all 13,463 with server-side filtering (city, score grade, segment, status,
  `matures_at` range, free-text) and the maturation chart. 13k rows never go to the browser.

Columns: score chip · address + city/neighborhood · type · rooms · sqm · price (+ price-change tag) ·
contact · phone (+ alternate) · **delisted date** · days on market · rounds · matures.

## 5. Templates — two, submitted to Meta up front

Both `MARKETING`, `he`, header TEXT = `street_city`, and a quick-reply button **"להסיר אותי"**
matching the existing v3 landlord templates. Copy is plural/gender-neutral throughout. Per the
client's decision the message says **"לפני כשנה"** — no exact date, no month variable. This keeps the
private template at two body params, which is also the smallest surface for Meta to reject.

**`landlord_renewal_private_v1`** — params `first_name`, `street_city` (8,048 leads)

> היי {{1}} 👋
>
> לפני כשנה הדירה שלכם ב{{2}} הייתה בפרסום להשכרה, ואז ירדה — כנראה כי מצאתם שוכרים. מקווים שהלך טוב.
>
> אנחנו רנט 360, מתווכים באזור. אם השוכרים מתחלפים בתקופה הקרובה, נשמח לחסוך לכם את הסיבוב: שוכרים
> מסוננים, ליווי חוזה וביטחונות, ותשלום רק על עסקה שנסגרה.
>
> שווה שיחה של 2 דקות?

**`landlord_renewal_repeat_v1`** — params `first_name`, `street_city`, `times_listed` (5,415 leads)

> היי {{1}} 👋
>
> הדירה שלכם ב{{2}} עברה כבר {{3}} סבבי פרסום להשכרה. אנחנו יודעים כמה הסיבוב הזה גוזל — מודעה,
> טלפונים, ביטולים, סינון.
>
> אנחנו רנט 360, מתווכים באזור. אם מתקרב סבב נוסף, אנחנו לוקחים אותו עליכם: שוכרים מסוננים, ליווי
> חוזה וביטחונות, ותשלום רק על עסקה שנסגרה.
>
> שווה שיחה של 2 דקות?

Neither states the fee amount — consistent with the approved `landlord_outreach_v3_*` templates; the
commission (one month's rent, VAT-inclusive, landlord-only, on closed deal) is stated by the bot in
conversation, which already hard-blocks approval before the fee is on the record.

`scripts/submit-renewal-templates.mjs`, modeled on the existing
`scripts/submit-escalation-template.mjs`, registers both at Meta and writes `whatsapp_templates` rows
with `status='pending'`. The existing `syncTemplateStatuses()` flips them to `approved` with no
redeploy.

## 6. Import

`scripts/import-renewal-leads.mjs` — a reusable tool, not a one-off, so the next city export runs
through the same path. Takes the two raw Nadlan One CSVs, performs the merge + scoring itself
(porting the verified logic behind `docs/haifa_unified.csv`), then upserts `properties` and inserts
`renewal_leads` in chunks. Idempotent on `(org_id, external_id)`. `--dry-run` prints every count and
writes nothing.

## 7. Verification (no test runner in this repo)

1. `--dry-run` reports: new vs existing properties, phone fills, phone conflicts, leads by segment
   and grade, and rows that will be created `skipped` — all reconciled against the numbers in §Source
   data before any write.
2. Spot-check 5 imported leads field-by-field against the source CSV.
3. Assert post-import: the 17 `approved_properties` leads are `status='skipped'`; no row with
   `outreach_blocked=true` is `pending`; no suppressed phone is `pending`; no existing property had a
   protected column changed (diff a pre-import snapshot of the 9,338).
4. `npm run build` + `npm run lint`.
5. First live send goes to the client's own number, before any real lead is touched.

## 8. Risks

- **MARKETING templates to a cold audience.** Meta approves this category less readily, and templates
  have sat `pending` here before. The pipeline is built and shipped regardless — it refuses to send
  until approval, and the page shows that state. Templates are submitted first so the clock starts.
- **13,463 people who never contacted rent360.** Raised previously; the client's decision. Mechanical
  protections: opt-out button on every template, suppression enforced per send, 250/day cap, send
  window, and manual approval on every batch.
- **The import writes to 9,338 existing production rows.** Mitigated by an explicit column allowlist,
  `--dry-run`, and check 3 above.
- **March 2026 gap** — ~1,000 leads missing until a re-export is requested.

## Acceptance

1. `--dry-run` reconciles exactly with the corrected figures; a live import creates 4,125 properties
   and 13,463 `renewal_leads`, and changes no protected column on the 9,338 existing rows.
2. `/renewals` "מבשילים" lists 259 leads today, honors filters, and previews the exact message.
3. A batch send respects suppression, the 17 approved properties, the daily cap and the send window,
   and stamps `status='sent'` with a real `thread_id` and `message_id`.
4. With the templates still `pending`, every send fails with `TEMPLATE_NOT_APPROVED` and the page
   says so plainly — nothing sends silently.
5. Both templates exist at Meta and in `whatsapp_templates`.

## Correction — 2026-09-01a (numbers, not design)

The original overlap figures in this spec were wrong. They came from a query that filtered
`city IN (…10 spellings…)`, written to answer a different question ("how many of these are in our DB
for this region"). **The import matches on `external_id` alone**, because `properties_external_id_unique`
is global — so it legitimately finds more existing rows than that query did.

The city filter silently dropped 2,372 rows whose `city` string is dirty but whose listing is squarely
in the region: `חיפה - מגורים` (1,044), `קרית חיים` (655 — a Haifa neighbourhood stored as a city),
`קרית אתא - מגורים` (163), `קרית מוצקין - מגורים` (126), `קרית ביאליק - מגורים` (114),
`קרית ים - מגורים` (80), plus rows where a whole street address was written into `city`.

| | was (wrong) | is (verified twice, independently) |
|---|---|---|
| properties to create | 6,201 | **4,125** |
| properties to update | 7,262 | **9,338** |
| phone fills | 3,616 | ~3,875 |
| phone conflicts | 893 | ~435 |
| already an approved property | 17 | **35** |
| phone coverage after import | 91% | **91.0%** (6,744/12,076 → 14,746/16,201) |

Nothing about the design changes. The headline — coverage rising to ~91% — survives. The `~` figures
vary by a handful depending on how the 3,146 two-number rows are normalized; the create/update split
is exact.

This also means `cleanCity()` (`lib/outreach/personalization.ts`) is doing more work than the spec
credited it for: it is the only thing that turns `חיפה - מגורים` into `חיפה` at send time.

## Out of scope

Re-export of March 2026 · fixing the upstream scraper to stop discarding movement dates (worth
raising separately — it is the root cause of the missing delist data) · other cities · any automatic
send without human approval.
