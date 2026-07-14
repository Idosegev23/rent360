# Escalation Reminders (Module A) — Design

**Date:** 2026-07-14
**Status:** Approved (build first, ahead of the other roadmap modules)
**Scope:** Nudge staff over WhatsApp when a conversation handed to a human is left undocumented.

## Problem

When either bot calls `handoff_to_human`, the thread flips to `status='human_takeover'` and an
admin WhatsApp alert fires once. After that, nothing chases it. Conversations sit untouched with no
documentation (no note, no callback logged), and no one is reminded to close the loop.

## Goal

- **24h** after a handoff with **no documentation** → WhatsApp **שי** ("חזרת אליו? עדכנת הערה?").
- **48h** after the same handoff with still no documentation → WhatsApp **זיו** (manager escalation).
- Never nag twice for the same handoff instance; a *new* handoff re-arms the clock.
- Respect the global send window (09:00–21:00 Israel, never Shabbat/חג) and template-approval gating.

## Non-goals

- No UI. This is a background cron + WhatsApp send only.
- No new DB tables/columns (zero DDL). Reuses `conversation_alerts`, `activity`, `whatsapp_templates`.
- Not handling the rare master-switch-off handoff path (orchestrator line ~114) that flips status
  without inserting a `conversation_alerts` row — v1 anchors on bot-initiated handoffs only.

## Key facts discovered

- `handoff()` (both `lib/ai/landlord-outreach/tools.ts` and `lib/ai/renter-reply-bot/tools.ts`)
  writes `conversation_alerts` with `type='handoff'`, `thread_id`, `created_at`. **This `created_at`
  is the escalation clock's anchor.**
- `conversation_alerts` columns: `id, org_id, thread_id, type, payload, read_at, sent_telegram_at, created_at`.
  `read_at` set = a human acknowledged the alert in the UI → counts as documentation.
- `activity` (polymorphic): `entity_type='thread', entity_id=<thread>, kind, body, created_at`.
  Documentation = a `note`/`call` activity created after the handoff.
- Staff (all `admin`, active, `receives_alerts`): שי `972527559049`, זיו `972545650748`,
  דנה `972533018220`, עידו `972547667775`.
- Existing infra to reuse: `canSendNow()` (`lib/time/send-window.ts`), `syncTemplateStatuses()`
  (`lib/whatsapp/template-sync.ts`), `sendTemplate()` (`lib/whatsapp/meta-provider.ts`), the
  `callback-reminders` cron as the structural template, and `whatsapp_templates` status gating.

## Design

### 1. Recipient resolution — `lib/alerts/escalation-recipients.ts`

`escalationTargets()` → `{ l1: {phone,name}, l2: {phone,name} }`.
- L1 (24h) phone from `ESCALATION_L1_PHONE` env, default `972527559049` (שי).
- L2 (48h) phone from `ESCALATION_L2_PHONE` env, default `972545650748` (זיו).
- Display name resolved from `users` by phone (fallback "שי"/"זיו"). Skip a level whose phone is empty.
- No DDL — env-configurable, DB-name-enriched.

### 2. Meta template `staff_escalation_reminder_v1` (UTILITY, he)

Body (4 params) + URL button to the thread:

```
היי {{1}}, שיחה שהועברה לטיפול אנושי עדיין לא תועדה.
לקוח: {{2}}
ממתין כבר: {{3}}
סיבה: {{4}}
חזרת אליו? עדכן/י הערה במערכת כדי לסגור את הלולאה.
```
Button: URL "פתח שיחה" → `https://rent360-vert.vercel.app/inbox/{{1}}` (thread id).

- **Creation:** add `createMessageTemplate()` to a new `lib/whatsapp/template-admin.ts`
  (`POST /{WABA}/message_templates`). A one-off script `scripts/submit-escalation-template.ts`
  submits it and upserts a `whatsapp_templates` row (status `pending`, `meta_template_id`).
- **Auto-approval:** the cron already calls `syncTemplateStatuses()`; when Meta approves, the row
  flips to `approved` and the dedicated template starts sending — no redeploy.
- **Immediate fallback:** until approved, send via the already-approved `admin_handoff_alert_v2`
  (identical shape: 4 body params + thread button), with the escalation framing carried in the
  `reason` param. Controlled by `ESCALATION_FALLBACK_TEMPLATE` (default `admin_handoff_alert_v2`);
  set empty to disable the fallback and wait for approval instead.

### 3. Send functions — extend `lib/alerts/staff-whatsapp.ts`

`notifyStaffEscalation({ orgId, level: 24|48, to, staffName, threadId, contactLabel, ageLabel, reason })`:
- Prefer `staff_escalation_reminder_v1` if `templateApproved()`; else the fallback template; else
  `{ sent:0, skipped:'no_template' }`.
- Build components (body params truncated ~60 chars, button param = threadId), `sendTemplate()`,
  audit into `messages` (same pattern as the existing staff functions).

### 4. Cron — `app/api/v1/cron/escalations/route.ts` (hourly)

Auth `Bearer CRON_SECRET` (like callback-reminders). Add path to `vercel.json` crons and to the
middleware allowlist. `maxDuration = 120`. GET and POST share one handler.

Per run:
1. `syncTemplateStatuses()` (pick up approval).
2. `send = await canSendNow()`. If not ok → do nothing (nothing stamped; re-fires when window reopens).
3. Load the **latest** `conversation_alerts` (`type='handoff'`) per thread from the last 30 days,
   whose thread is still `status='human_takeover'`. `T` = that alert's `created_at`.
4. For each, `ageH = now - T`. First check **documented?** — true if an `activity`
   (`kind in note/call`, thread entity) exists with `created_at > T`, OR the alert's
   `read_at is not null`. Documented → skip the thread entirely. Otherwise evaluate the two
   levels **independently**:
   - **L1 (24h):** if `ageH >= 24` and no `activity kind='escalation_reminder_24h'` since T →
     send to שי, then insert that activity row.
   - **L2 (48h):** if `ageH >= 48` and no `activity kind='escalation_reminder_48h'` since T →
     send to זיו, then insert that activity row.
   - In steady state these fire one run (~a day) apart: the thread crosses 24h first (שי), then 48h
     (זיו). Only a cold-start/backlog thread already past both fires both in the same run — which is
     correct: both should know.
5. Return a JSON summary `{ ok, scanned, l1_sent, l2_sent, skipped, errors }`.

**Dedupe** is entirely `activity` rows keyed to "since T", so a re-handoff (newer T) re-arms both levels.

### 5. Dry-run for verification (no test runner in this repo)

`GET /api/v1/cron/escalations?dryRun=1` (still requires `CRON_SECRET`) runs steps 1–4 and returns the
**would-send** list without sending or stamping. This is the acceptance check against production data.

## Files

- new `lib/alerts/escalation-recipients.ts`
- new `lib/whatsapp/template-admin.ts` (`createMessageTemplate`)
- new `scripts/submit-escalation-template.ts` (one-off submit + register)
- new `app/api/v1/cron/escalations/route.ts`
- edit `lib/alerts/staff-whatsapp.ts` (+`notifyStaffEscalation`)
- edit `vercel.json` (+cron entry), `middleware.ts` (+allowlist path)
- `.env.example` (+`ESCALATION_L1_PHONE`, `ESCALATION_L2_PHONE`, `ESCALATION_FALLBACK_TEMPLATE`)

## Acceptance

1. `dryRun=1` against prod lists real undocumented human_takeover threads with correct ages/levels.
2. Template submitted to Meta and present in `whatsapp_templates` (pending), visible in WhatsApp Manager.
3. A live run inside the send window WhatsApps שי for a ≥24h undocumented handoff (via fallback
   template today), stamps `escalation_reminder_24h`, and does not re-send on the next run.
4. Adding a note to that thread stops further escalation; it does not reach זיו at 48h.
5. Outside the window / on Shabbat: zero sends, nothing stamped.
