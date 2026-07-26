# Tasks handoff notes + dashboard task view + closed-deal doc reminder — Design

**Date:** 2026-07-15 · **Status:** Approved (client requests #1, #2, #5).

## Context (what already existed)
- Tasks already have title, due date, and **reassignment** (EditTaskModal → assignee select). ✅
- The dashboard already lists the current user's tasks (title + due date) via `MyDayPanel`. ✅
- Contracts are uploaded on the property page (Documents tab, `kind='contract'`); a closed deal is a
  `tenancies` row with `created_by` = the broker who closed it.

## Feature 1 — task handoff notes (the gap in #1)
Let people attach a note/request when handing a task over or returning it, kept as history.
- Backed by the **activity log** (`entity_type='task'`, `kind='note'`) — author + time preserved.
- `EditTaskModal` gains a "הערה / בקשה בהעברה" textarea; on save it POSTs an activity note.
- `GET /api/v1/tasks` now attaches `notes_count` + `last_note` per task (one extra activity query).
- Task card shows the latest note inline (amber) + a `TaskNotes` expander to read the full thread and
  add a note. No DB change.

## Feature 2 — dashboard task list, for daily management (#2)
`MyDayPanel` already lists my tasks + dates; enhanced for at-a-glance daily use:
- Due label is color-coded: **באיחור** (red), **היום HH:MM** (amber), **מחר**, else date.
- A small priority dot for high/urgent. No DB change.

## Feature 5 — closed-deal missing-contract reminder (#5)
New daily cron `/api/v1/cron/deal-doc-reminders`:
- Finds active tenancies closed **>MIN_HOURS (24)** and **<MAX_DAYS (14)** ago with **no `kind='contract'`
  document** on the property / tenancy / renter, not already reminded.
- Creates a HIGH-priority **task** for the broker (`assignee = tenancy.created_by`) — "⚠️ חסר חוזה
  בעסקה — <property>" linked to the property — so it surfaces on their dashboard/tasks. Records an
  activity marker on the tenancy (`metadata.deal_doc_reminder`) to dedupe (one per deal). One
  Telegram admin ping summarizes the run.
- In-app + Telegram only → no send-window / Meta-template dependency; ships today. Guards: window +
  `MAX_PER_RUN` (20). `GET ?dryRun=1` = plan only. Allowlisted in middleware; daily in vercel.json.
- Verified against prod: 7 active deals → 2 in-window missing a contract → 2 would remind (safe).
- Follow-up (optional): also WhatsApp the broker (needs a dedicated staff template).

## Acceptance
1. Editing a task with a handover note stores it; the recipient sees it on the task card + thread.
2. Dashboard task list shows overdue in red / today / friendly dates + priority dots.
3. `dryRun=1` lists the undocumented recent deals; a live run creates a broker task + dedupes.
