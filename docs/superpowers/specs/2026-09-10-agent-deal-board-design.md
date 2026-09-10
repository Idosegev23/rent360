# Agent deal board (`/board`) — Design

**Date:** 2026-09-10 · **Status:** Approved (scope, stages, targets and backfill confirmed by the client).

**Purpose:** a daily control board Shai walks through with Ziv — every open property he owns, what
stage it is in, how long it has sat there, what happens next — against his monthly target.

## Context (what already existed)

- **`/pipeline` stays as is.** It derives stages from threads/approvals/tenancies
  (`contacted → in_convo → approved → rented`) and is read-only: an agent cannot say "waiting for
  cheques" or "owner not answering". That is the gap this board fills.
- **`tasks`** — `assignee_user_id`, `due_at`, `entity_type='property'`, `entity_id`. "Call the
  owner" is already a task.
- **`meetings`** — `property_id`, `starts_at`, `owner_user_id`, Google Calendar sync. "Meeting
  tomorrow" is already a meeting.
- **`activity`** with `kind = 'status_change'`, written by `logActivity()` (`lib/activity/log.ts`,
  best-effort, never throws).
- **`POST /api/v1/properties/[id]/assign`** — `{ agentUserId }`, rejects inactive agents.
- **`tenancies`** — 10 rows, all `created_by` Shai, `commission_amount` filled on 10/10. `/commissions`
  already reads this table.
- **`requireOrg()`** returns `{ sb, orgId, uid, role }`. All four staff share identical permissions —
  no role gating.
- Measured today: 64 approved properties (not irrelevant). Shai **approved 37** but only **12 are
  assigned** to him — `assigned_agent_user_id` is used inconsistently.

## 1. Data model — migration 0041

**`deal_stages`** — one row per property; the agent-owned working state.

```sql
property_id       uuid PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE
org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
stage             text NOT NULL   -- CHECK in the 7 keys below
stage_changed_at  timestamptz NOT NULL DEFAULT now()
note              text
updated_by        uuid REFERENCES users(id) ON DELETE SET NULL
updated_at        timestamptz NOT NULL DEFAULT now()
```

`stage_changed_at` is the point of the table: it yields **"N days in this stage"**, which is what
turns a status list into a review. History lives in `activity` (`kind='status_change'`), not here.

**`agent_targets`**

```sql
id                 uuid PRIMARY KEY
org_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE
month              date NOT NULL          -- always the 1st of the month
target_deals       int  NOT NULL DEFAULT 0
target_commission  int  NOT NULL DEFAULT 0   -- ₪, VAT-inclusive, matching commission_amount
UNIQUE (org_id, user_id, month)
```

Both tables get the standard org RLS policy (`org_id = public.jwt_org_id()`), matching 0037/0038.
Not added to `properties`: it is already 47 columns, and this is agent working state, not a fact
about the property.

### The seven stages

| key | label |
|---|---|
| `new` | חדש |
| `waiting_owner` | ממתין למענה מבעל הבית |
| `scheduling_viewing` | בתיאום צפייה |
| `viewed` | צפייה בוצעה |
| `docs_pending` | ממתין למסמכים וצ׳קים |
| `signed` | חוזה נחתם |
| `stuck` | תקוע |

### Effective stage (read-time rules, no seeding writes)

1. A property with an **active tenancy** is `signed`, regardless of any stored stage. A tenancy is
   ground truth that a contract exists; this keeps the board and the target from contradicting each
   other (a deal cannot count toward target while sitting in "waiting for cheques").
2. Otherwise the stored `deal_stages.stage`.
3. No row → `new`. No backfill of stages is needed; the first review sets them.

`signed` shows only deals whose month anchor (§4) is the current month, collapsed by default.
Older signed deals leave the board — it is a board of **open** properties.

## 2. Scope — whose properties

The board shows approved, not-irrelevant properties where
`properties.assigned_agent_user_id = <selected agent>`, defaulting to the viewer. An agent selector
("הלוח של") lets Ziv switch to Shai's board during the review.

### One-time assignment backfill

So that rule works on day one, a script assigns each unassigned approved property to whoever
approved it — **only when that approver is an active user**, and **never overwriting** an existing
assignment. Dry-run measured against production:

| | count |
|---|---|
| already assigned | 12 |
| → assigned to שי | **29** |
| → assigned to עידו | 1 |
| stays unassigned — no approver | 13 |
| stays unassigned — approved by "Rent Admin" (inactive demo account) | 8 |
| stays unassigned — approved by דריה (offboarded) | 1 |

Shai's board: **12 → 41**. The active-user rule matters: without it, 9 properties would land on
accounts nobody logs into and vanish from every board. Each assignment is logged via
`logActivity(kind: 'system')`. The script runs `--dry-run` first and is re-runnable (it only touches
rows that are still unassigned).

### Surfacing the orphans

The **22** that stay unassigned — and any future ones — are **surfaced**, not hidden: a strip at the
top of the board, visible regardless of the agent selector: "22 נכסים מאושרים ללא סוכן", expandable,
each row with "שיוך אליי", which calls the existing assign endpoint with the viewer's id.

## 3. API

All three use `requireOrg()` (matching `/pipeline` and the assign route) and filter `org_id` on
every query.

**`GET /api/v1/board?agent=<uid>`** →

```ts
{
  me: { id: string }
  agents: Array<{ id: string; name: string }>        // active users, for the selector
  targets: { month: string; targetDeals: number; targetCommission: number;
             actualDeals: number; actualCommission: number }
  orphans: BoardItem[]
  groups: Array<{ stage: StageKey; label: string; items: BoardItem[] }>
}
type BoardItem = {
  propertyId: string; label: string; ownerName: string | null; ownerPhone: string | null
  stage: StageKey; daysInStage: number; note: string | null
  nextTask: { id: string; title: string; dueAt: string | null } | null     // soonest open task
  nextMeeting: { id: string; title: string; startsAt: string } | null      // soonest upcoming
  updatedBy: string | null; updatedAt: string | null
}
```

`me.id` comes from `ctx.uid`. Returning it here avoids modifying the shared `/api/me` endpoint.
Within each group, items sort by `daysInStage` descending — stalest first, which is the order a
review should go in.

**`POST /api/v1/board/stage`** `{ propertyId, stage, note? }` — validates the property belongs to
the org and the stage key is one of the seven; upserts `deal_stages`; sets `stage_changed_at = now()`
**only when the stage actually changes** (editing the note must not reset the clock); writes
`logActivity({ kind: 'status_change', metadata: { from, to } })` on a change.

**`PUT /api/v1/board/targets`** `{ userId, month, targetDeals, targetCommission }` — upsert on
`(org_id, user_id, month)`.

## 4. Targets

Actuals come from `tenancies` where `created_by = <agent>`, counted in the month of
`coalesce(started_at, created_at)` → count, and `sum(commission_amount)`. **No status filter:** the
column only allows `active` and `ended`, and an `ended` tenancy is still a deal that closed — it
must keep counting toward the month it closed in.

The anchor is a stated decision: a deal recorded now with a future move-in date counts in its
move-in month (one existing row starts 2026-09-23). The alternative — `created_at` as "closed date" —
is weaker because bulk-imported deals share an import date. Change one expression if the business
prefers otherwise.

Measured on today's data: September has 2 deals, ₪10,400.

## 5. The page `/board`

- **Top:** agent selector · month target progress (deals X/Y, ₪X/₪Y) with inline edit.
- **Orphans strip** (§2), always shown when non-empty.
- **Stage groups** in the order of §1; `stuck` visually distinct; `signed` collapsed.
- **Each row:** address (links to the property page) · owner + phone · stage selector · days in
  stage · next task and next meeting (read-only, linking out to `/tasks` and `/meetings`) · note,
  editable inline.
- Sidebar entry **"לוח בקרה"**.
- Hebrew RTL; every user-facing string gender-neutral, button labels in noun form (שמירה, שיוך
  אליי, עריכת יעד), consistent with `/renewals`.

## 6. Verification

No test runner exists. Verification is: backfill `--dry-run` reconciling exactly to §2's table;
`npm run build`; `ESLINT_USE_FLAT_CONFIG=false npm run lint`; authenticated HTTP `GET /api/v1/board`
whose item and orphan counts equal the counts recomputed from the data — Shai's 41 assigned and the
22 unassigned, each **less** any property whose signed month has already passed (the board shows
open properties, so not 41 flat); one stage change producing a `deal_stages` row and an
`activity` row, with a note-only edit leaving `stage_changed_at` unchanged; then a look in the browser.

## Execution

Inline in the session, with one review at the end — not a subagent per task. The only step that
writes to existing production rows is the backfill (30 `properties` rows); it runs dry first and
waits for confirmation before the live write.

## Out of scope

Drag-and-drop kanban · alerts when a deal is stuck · creating or editing tasks and meetings inside
the board (it links out) · per-stage time limits · changes to `/pipeline`.

## Changes after code review (2026-09-10)

One review of the branch found nothing critical; all five invariants held. Changes made in response:

- **Claiming an orphan uses `POST /api/v1/board/claim`, not the general assign endpoint** (a deviation
  from §2). The claim succeeds only while the property is still unassigned, so two people claiming the
  same orphan cannot silently take it from each other (the second gets 409), and every claim is logged
  to `activity`. The general assign endpoint keeps overwriting by design — it serves the property page.
- **Note-only saves write the note columns only.** Previously a note save re-wrote the stage it had
  just read, so a concurrent stage change by the other person on the same property could be reverted.
- **Ended tenancies.** A stored stage set before a tenancy that has since ended is treated as stale: the
  property reads as `new`, counted from the end date, in both the GET and the stage POST. Otherwise a
  property coming back to market would show its pre-rental stage with a months-long red counter.
- **Month anchors are Israel-local** for timestamp columns (`israelDateOf`).
- **The GET fails loudly** on any query error instead of rendering every stage as `new` with a zero
  target — e.g. if the code is deployed before 0041 is applied.
- The targets form writes for the agent the payload describes (`agentId`), not the selector, so a fast
  agent switch cannot save one agent's numbers onto another.
