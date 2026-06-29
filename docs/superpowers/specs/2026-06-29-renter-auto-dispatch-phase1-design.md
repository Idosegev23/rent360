# Renter Auto-Dispatch — Phase 1 Design

**Date:** 2026-06-29
**Status:** Approved for build
**Scope:** Phase 1 of the holistic renter loop. Automatic dispatch of ≥90% property
matches to renters (paced, capped, in send-window) + a unified, visible per-renter
send counter that also covers manual sends. **Out of scope:** the renter-reply bot
(Phase 2) and the smart viewing scheduler (Phase 3).

This builds entirely on the existing dispatch path — it does **not** replace it. The single
source of truth for "we sent this property to this renter" stays `matches.renter_notified_at`,
written by `dispatchRenterMatchAlert()` (`lib/outreach/renter-alert.ts`). Every send — auto or
manual — already flows through that one function, so the counter is unified by construction.

---

## 1. Goals (what "done" means)

1. A renter who has filled the questionnaire (`submissions_count > 0`) automatically receives
   property matches scored **≥ 90**, with **no human action**.
2. **At most 3 per renter per day**, **spread out (never back-to-back)**. The 4th+ match waits
   for the next day.
3. A **new** approved property that scores ≥ 90 for a renter is dispatched the same way (no
   separate mechanism — it enters the same queue and the hourly run picks it up).
4. **Never** send the same property to the same renter twice (already guaranteed by
   `renter_notified_at` + the unique `(org_id, renter_id, property_id)` match row).
5. **Never** send outside 09:00–21:00 Israel, and **never** on Shabbat/Yom-Tov (already enforced
   inside `dispatchRenterMatchAlert` via `canSendNow()`).
6. A **per-renter send counter** ("נשלחו X/3 היום · Y סה״כ") is visible on the renter list and
   renter detail page, and counts **both** auto and manual sends.
7. A **manual** send beyond 3/day is **not silently allowed**: the operator sees the count and
   must explicitly confirm an override (manual = human judgment, so we warn, not hard-block).

## 2. Non-goals (Phase 1)

- No renter-reply AI bot (renter threads stay `human_takeover`). Phase 2.
- No viewing scheduling. Phase 3.
- No new template; relies on `renter_match_alert_v2`/`v1` already in `whatsapp_templates`.
- No change to the matching engine or scores.

---

## 3. Current state (verified in code)

- `lib/outreach/renter-alert.ts::dispatchRenterMatchAlert()` — the **only** send path. Enforces
  send-window (hard, even on `force`), renter/property validation, image/rooms/price/city
  presence, suppression/opt-out, dedup (`matchId` → `renter_notified_at`), template-approval gate.
  On success writes a `messages` row (`metadata.kind='renter_match'`, `sent_by`), upserts the
  renter thread (`human_takeover`, `tags.audience='renter'`), and stamps `matches.renter_notified_at`.
- `app/api/v1/outreach/notify-renters-pending/route.ts` — **POST-only**, Bearer `CRON_SECRET`.
  Selects matches `renter_notified_at IS NULL`, `is_disqualified=false`, `score >= MIN_SCORE`
  (env `RENTER_ALERT_MIN_SCORE`, default **70**), score desc. Caps: `RENTER_ALERT_BATCH_SIZE`
  per run, `RENTER_ALERT_DAILY_CAP` (shared template/day). **No per-renter cap. Not scheduled.**
- `app/api/v1/outreach/renter-send-batch/route.ts` — admin manual batch (body `matchIds`). Already
  enforces `RENTER_PER_DAY_CAP` (default **1**) by counting today's `renter_notified_at`.
- `app/api/v1/outreach/notify-renter/route.ts` — admin single send (cookie auth). Goes through the
  dispatcher with `sentByUserId`. **Bypasses caps** today (by design: manual self-governs).
- `lib/outreach/governance.ts` — `DAILY_CAP=250`, `RENTER_PER_DAY_CAP=1`, `RENTER_MIN_SCORE=70`,
  jitter 1.5–3s, `MANUAL_BATCH_MAX=50`, `templatesSentToday()`, `recipientMessageCounts()`.
- `app/api/v1/renters/route.ts` — renter list; already excludes **placed** renters (active tenancy)
  by default and attaches a non-DQ match count. `submissions_count` is the vetted flag.
- `vercel.json` — crons: `callback-reminders` (\*/30), `matches/backfill` (daily 02:00 UTC). **No
  renter-alert cron.**

**Timezone note:** existing caps use UTC day start (`setUTCHours(0,0,0,0)`). Israel is UTC+2/+3,
so the UTC-day boundary falls at 02:00–03:00 Israel — inside quiet hours, never splitting an active
sending day (09:00–21:00). Phase 1 keeps this convention for consistency.

---

## 4. Design

### 4.1 The auto-dispatch cron (`notify-renters-pending`)

Evolve the existing route; do not create a new one.

- **Add a `GET` handler.** Vercel Cron invokes the path with `GET`; the route is POST-only today.
  Refactor the body into a shared `run(req)` and export both `GET` and `POST` (mirror
  `app/api/v1/cron/callback-reminders/route.ts`). Both keep the `Bearer CRON_SECRET` check.
- **Threshold:** default min score **90** (still `RENTER_ALERT_MIN_SCORE`-overridable). Update the
  route default and `governance.RENTER_MIN_SCORE` default to 90.
- **Per-renter pacing + cap:**
  - Compute each candidate renter's **sends today** = count of their `matches` with
    `renter_notified_at >= utcDayStart` (same query shape as `renter-send-batch`).
  - Maintain a per-run `sentThisRun` set of renter ids.
  - Skip a candidate if: its renter already has `>= RENTER_PER_DAY_CAP` (3) today, **or** the renter
    is already in `sentThisRun` (enforces **≤ 1 per renter per run** = the "not back-to-back"
    spacing, since runs are hourly).
- **Safety filters on candidates** (all must hold to dispatch):
  - Renter is **vetted**: `submissions_count > 0`. (Fetch `submissions_count` for candidate
    renter ids in one query and filter; matches has no such column.)
  - Renter is **not placed**: no active `tenancies` row. (Reuse the list's pattern: load active
    tenancy renter ids, exclude.)
  - Property is **active**: `properties.is_active = true` (don't alert on rented/off-market homes;
    the dispatcher does not check this). Fetch `is_active` for candidate property ids and filter.
  - Keep existing: `renter_notified_at IS NULL`, `is_disqualified=false`, `score >= 90`.
- **Over-fetch** (already `limit*3`) to absorb rows dropped by the new filters; raise the multiplier
  to ~5 so a run can still fill `limit` after filtering.
- **Schedule** in `vercel.json`: `{ "path": "/api/v1/outreach/notify-renters-pending", "schedule": "0 * * * *" }`
  (top of every hour). Out-of-window/Shabbat runs send nothing (dispatcher guard), so hourly is safe.
- Response JSON keeps `sent`, `skipped`, per-row `results`, plus new counters: `skippedCapped`,
  `skippedUnvetted`, `skippedPlaced`, `skippedInactiveProp`.

### 4.2 Unified per-renter send counter

- **New helper** `renterSendCounts(orgId, renterIds): Promise<Record<string,{today:number;total:number}>>`
  in `lib/outreach/governance.ts`. Source = `matches.renter_notified_at` (the unified signal):
  `total` = rows with `renter_notified_at IS NOT NULL`; `today` = rows with
  `renter_notified_at >= utcDayStart`. One query over the renter ids, bucketed in JS.
- **Renter list API** (`app/api/v1/renters/route.ts`): attach `send_counts` per renter
  (`{ today, total }`) alongside the existing `matches` count. Reuse the already-fetched
  `renterIds`.
- **Renter detail**: surface `{ today, total }` for the one renter (extend whatever feeds
  `app/renters/[id]/page.tsx`; if it has no dedicated API, compute via `renterSendCounts` in the
  page's server data path or a small endpoint).
- **UI:**
  - Renter list (`app/renters/page.tsx`): a small badge per card — `נשלחו {today}/3 היום · {total} סה״כ`.
    When `today >= 3`, tint it (e.g. amber) to signal "at daily cap".
  - Renter detail (`app/renters/[id]/page.tsx`): same line near the header/stats.
  - Hebrew must be gender-neutral (e.g. "נשלחו", not gendered verbs).

### 4.3 Manual-send over-cap guard (warn + confirm)

- `app/api/v1/outreach/notify-renter/route.ts`: before dispatch, compute the renter's sends today.
  If `today >= RENTER_PER_DAY_CAP` **and** the request did not pass `confirmOverCap: true`, return
  `409 { error: { code: 'CAP_WARNING', message, sentToday } }` **without sending**. With
  `confirmOverCap: true`, proceed (and the override is recorded implicitly via the normal
  `sent_by` on the message).
- The calling UI (renter detail / renter-queue send buttons): on `CAP_WARNING`, show a confirm
  dialog ("כבר נשלחו X היום — לשלוח בכל זאת?") and, on confirm, re-POST with `confirmOverCap: true`.
- Do **not** change `renter-send-batch` cap behavior (it already skips over-cap renters); just
  align its `RENTER_PER_DAY_CAP` to 3 via the shared constant.

### 4.4 Governance constants (`lib/outreach/governance.ts`)

- `RENTER_PER_DAY_CAP` default `1 → 3`.
- `RENTER_MIN_SCORE` default `70 → 90`.
- Add `renterSendCounts()` (§4.2).
- Env overrides still win (`RENTER_PER_DAY_CAP`, `RENTER_ALERT_MIN_SCORE`).

---

## 5. Operational prerequisite (must verify before enabling)

`renter_match_alert_v2` or `renter_match_alert_v1` must be `status='approved'` in
`whatsapp_templates`. If neither is approved the dispatcher returns `TEMPLATE_NOT_APPROVED` and the
cron sends nothing (fails safe). Verify via Supabase before/after deploy. (Supabase MCP was
disconnected at design time; re-check when reconnected.)

---

## 6. Files touched

| File | Change |
|---|---|
| `lib/outreach/governance.ts` | caps→3/90; add `renterSendCounts()` |
| `app/api/v1/outreach/notify-renters-pending/route.ts` | `GET`+`POST` via `run()`; min 90; per-renter cap/pacing; vetted/placed/active filters; richer response |
| `app/api/v1/outreach/notify-renter/route.ts` | over-cap `CAP_WARNING` unless `confirmOverCap` |
| `app/api/v1/renters/route.ts` | attach `send_counts` per renter |
| `app/renters/page.tsx` | per-renter send badge |
| `app/renters/[id]/page.tsx` | per-renter send line (+ over-cap confirm on manual send) |
| `vercel.json` | hourly cron for `notify-renters-pending` |

## 7. Testing / verification (no test runner in repo)

- `npx tsc --noEmit` clean (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- `npm run build` succeeds.
- Logic checks (reasoned + via Supabase queries once reconnected):
  - Cron run: a vetted renter with 5 ≥90 matches gets exactly 1 per run, 3 max/day, rest deferred.
  - Unvetted / placed / inactive-property candidates are skipped (counted in the response).
  - Dedup: a row with `renter_notified_at` set is never re-sent.
  - Manual send to a renter already at 3 today returns `CAP_WARNING`; with `confirmOverCap` it sends.
  - Counter equals `matches.renter_notified_at` counts and reflects a manual send immediately.
- No regression to `renter-send-batch`, `renter-queue`, `notify-renter` happy paths.

## 8. Rollout

Work on `feature/renter-auto-dispatch`. After review + green tsc/build: verify template approval,
merge to `main`, `npx vercel --prod`. The hourly cron begins automatically. Watch the first runs'
response counters; tune `RENTER_ALERT_BATCH_SIZE` if needed.
