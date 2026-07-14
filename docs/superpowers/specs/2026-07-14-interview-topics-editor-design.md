# Editable Interview Topics (Module C) — Design

**Date:** 2026-07-14 · **Status:** Approved (build third). Built on top of the committed intake
normalization work (f0e2331).

## Goal
Let staff edit the renter-interview bot's "מה-לאסוף" question list (title/body/order/enabled/add/
remove) from the admin UI, without touching code. Everything else in the intake prompt (personality,
rules, closing, the collect-intro/outro wrapper) stays in code.

## Schema — migration `0036_interview_topics.sql` (table only, no seed)
`interview_topics (id, org_id, key, title, body_text, sort_order, enabled, created_at, updated_at)`,
UNIQUE (org_id, key), index (org_id, sort_order), RLS org-scoped (`jwt_org_id()`), like `activity`.
No seed row: `DEFAULT_TOPICS` in code is BOTH the canonical seed and the runtime fallback, so the bot
works with zero rows and the first admin save persists an editable copy.

## Prompt wiring — `lib/ai/renter-interview/`
- New `topics.ts`: `DEFAULT_TOPICS` (the 8 current topics), `renderTopics()` (→ numbered list),
  `getEnabledTopics(orgId)` (enabled topics ordered; falls back to DEFAULT_TOPICS on empty/error; never throws).
- `system-prompt.ts`: `CORE` const → `coreWithTopics(topicsBlock)`; `buildRenterSystemPrompt` is now
  **async** `(ctx, orgId?)` and injects `renderTopics(await getEnabledTopics(orgId))`.
- `agent.ts`: `await buildRenterSystemPrompt(ctx, thread.org_id)`.

## API — `app/api/v1/interview-topics/route.ts` (requireOrg)
- GET → org's topics ordered, or `DEFAULT_TOPICS` with `saved:false` when none stored.
- PUT `{ topics: [...] }` → validate (key slugified a-z0-9_, title/body required, no dup keys),
  upsert by (org_id,key), delete removed keys, return the stored list. `sort_order` = array index.

## UI — `app/admin/interview/page.tsx` + card on `app/admin/page.tsx`
Client editor: per-topic title input + body textarea + enabled checkbox + up/down reorder + delete,
"add topic", sticky Save bar with dirty/saved/error state. Gender-neutral Hebrew.

## Acceptance
1. Migration applied; table exists. Bot prompt unchanged in behavior when no rows (fallback).
2. /admin/interview lists the 8 default topics (saved:false), edit+save persists (saved:true).
3. Disabling/reordering/adding a topic changes what the bot collects on the next conversation.
4. A save that would leave zero topics is rejected; the bot never loses its question list.
