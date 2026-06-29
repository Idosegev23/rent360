# Renter Reply-Bot — Phase 2 Design

**Date:** 2026-06-29
**Status:** Approved for build
**Scope:** Phase 2 of the holistic renter loop. When a renter replies on WhatsApp to a
property-match alert (Phase 1), an AI agent answers Q&A about **that** property using only
share-safe data (**never the street address**), detects intent (interested / not-interested /
question / talk-to-human / stop), reuses the existing renter-interest plumbing on "interested",
and hands off to a human when needed. **Out of scope:** the smart viewing scheduler (Phase 3).

Builds on Phase 1 (`lib/outreach/renter-alert.ts`) and the existing orchestrator
(`lib/ai/conversation-orchestrator.ts`). Does **not** replace the intake bot
(`lib/ai/renter-interview/`) — adds a *second* renter agent for a different stage.

---

## 1. Current state (verified in code)

- Renter match-alert threads are created by `dispatchRenterMatchAlert()` in
  **`status='human_takeover'`** with `tags={audience:'renter', renter_id, renter_name}` and the
  thread anchored to the alerted `property_id`.
- The webhook (`app/api/v1/integrations/whatsapp/webhook/route.ts:225`) **skips** any thread in
  `human_takeover`/`opted_out`/`admin_alerts` → renter replies are parked for a human today.
- The orchestrator (`conversation-orchestrator.ts:101-106`) routes `tags.audience==='renter'` →
  `runRenterAgentTurn` (the **intake** bot). Intake threads (created by
  `outreach/renter-questionnaire-batch`) carry the **same** `audience:'renter'` tag — so a new
  discriminator is needed to tell *intake* from *match-reply*.
- There is already a **renter-interest** path: `app/api/v1/shares/[token]/interest/route.ts` drops
  an inbound "interested" message, sets `tags.interested=true`, flips to `human_takeover`, calls
  `notifyAdminsRenterInterest()` (`renter_interest_alert_v2`, approved) and emails the assigned agent.
- Share-safe property view: `app/api/v1/shares/[token]/route.ts` returns city+neighborhood (never
  `street`), AI copy via `processPropertyForSharing`, and `buildMatchInfo()` for the % breakdown.
- Free-text replies require Meta's 24h session window (open the moment the renter replies);
  `isInSessionWindow()` already guards this in the orchestrator.

## 2. Goals

1. A renter who replies to a match alert gets a helpful, **address-safe** AI answer about that
   property — within the 24h window, in send-hours (Shabbat guard is moot for free-text replies
   since they're reactive, but we keep the same posture).
2. The bot **never** discloses the street/house number/exact address. If asked, it explains the
   address is shared when a viewing is set, and offers to arrange one.
3. Intent is detected and acted on via tools: **interested** → reuse interest plumbing (alert
   staff) ; **not-interested** → record + stop ; **wants a human / complex** → handoff ;
   **stop/opt-out** → suppress.
4. The **landlord** outreach bot must never run on a renter thread (already true via routing; add a
   defensive guard).
5. **Safe rollout:** everything is gated by `RENTER_REPLY_BOT_ENABLED` (default off). With it off,
   behaviour is exactly today's (renter replies parked for a human).

## 3. Non-goals (Phase 2)

- No viewing scheduling / calendar (Phase 3). On "interested" we alert staff (existing flow); a
  human (or Phase 3) schedules.
- No change to matching, scoring, or the intake bot.
- No new Meta template (free-text replies only, plus the already-approved interest/handoff alerts).

---

## 4. Design

### 4.1 Thread discriminator + status (renter-alert.ts)

`dispatchRenterMatchAlert()` already anchors `property_id` and tags `audience:'renter'`. Add:

- Tag `renter_stage:'match_reply'` on the thread (new threads and on each send to an existing one),
  so the orchestrator can distinguish match-reply from intake.
- **When `RENTER_REPLY_BOT_ENABLED` is true**, create/keep the thread in **`status='active'`** (so the
  webhook + orchestrator process replies). When false, keep today's `human_takeover` (parked).
- For an **existing** thread (renter already had an intake/earlier thread), on send: set
  `tags.renter_stage='match_reply'`, anchor the new `property_id`, and (if enabled) set
  `status='active'` — *unless* the thread is already `opted_out` (never resurrect an opt-out).
- `upsertRenterThread()` currently early-returns an existing thread untouched; extend it to apply
  the stage tag + status per the flag.

### 4.2 Orchestrator sub-route (conversation-orchestrator.ts)

Replace the single `isRenter ? intake : landlord` branch with:

```
if (isRenter && tags.renter_stage === 'match_reply') {
  if (!replyBotEnabled()) { park to human_takeover; return }   // defensive
  turn = await runRenterReplyTurn({ threadId, userText, imageUrls })
} else if (isRenter) {
  turn = await runRenterAgentTurn(...)        // intake (unchanged)
} else {
  turn = await runAgentTurn(...)              // landlord (unchanged)
}
```

### 4.3 New agent module `lib/ai/renter-reply-bot/`

Mirror `renter-interview/` structure (OpenAI Responses API, `store:true`, `previous_response_id`,
tool loop ≤6, `humanizeReply`, persist `openai_response_id`).

- **`property-context.ts`** — `loadReplyContext(orgId, threadId)`:
  - Resolve `renter_id` + `property_id` from the thread (tags + anchor).
  - Fetch renter: `first_name`, a few prefs (budget, rooms, move-in) for tone only.
  - Fetch property **share-safe** (SELECT must **not** include `street`): city, neighborhood, price,
    rooms, sqm, floor (as a coarse hint only), amenities, available_from, type, condition,
    pets_allowed, smokers_allowed, long_term, description.
  - AI copy: reuse `processPropertyForSharing` (best-effort; fall back to raw description).
  - Match info: find this renter's `property_shares` row (renter_id+property_id) → `match_id` →
    `buildMatchInfo`-equivalent (% fit, matches[], missing[]). Also yields the **share token** so the
    bot can (re)send the `/share/<token>` link.
- **`system-prompt.ts`** — Hebrew, gender-neutral, no emojis, 1–3 sentence replies. Role: answer the
  renter's questions about **this one** property from the provided safe facts; sell gently; **hard
  rule: never reveal street/number/exact address** — if asked, say the exact address is shared when
  a viewing is arranged and offer to set one up (→ `express_interest`). Use tools for intent. If the
  renter asks about a *different* apartment / changes their search → `handoff_to_human` (Phase 2
  doesn't re-interview). Bake the safe property block + match block + share URL into the prompt.
- **`tools.ts`**:
  - `express_interest(note?)` — renter wants to view / proceed. Reuse interest plumbing: insert an
    `meta_message_type:'interest'` inbound row, set `tags.interested=true`, call
    `notifyAdminsRenterInterest()` + (best-effort) the assigned-agent email — refactor the body of
    `shares/[token]/interest` into a shared `recordRenterInterest()` in `lib/outreach/` and call it
    from both places. Keep the thread **active** (renter may keep chatting); staff is alerted.
  - `record_not_interested(reason?)` — set `tags.intent='not_interested'`, drop a short note;
    thank + close politely. No handoff.
  - `send_property_link()` — (re)send the renter's `/share/<token>` link (preview off).
  - `handoff_to_human(reason)` — flip `status='human_takeover'`, `notifyAdminsHandoff()`.
  - `opt_out(reason?)` — soft opt-out (the renter says stop): `recordOptOut()` + confirm. (Hard
    stop-words are already caught upstream in the webhook.)
- **`agent.ts`** — `runRenterReplyTurn(input): Promise<{text, responseId, toolCalls}>`.

### 4.4 Landlord-agent guard

At the top of `runAgentTurn` (landlord), if the thread's `tags.audience==='renter'`, return a no-op
(empty text) and log — defensive belt-and-suspenders so a future routing change can't make the
landlord bot answer a renter.

### 4.5 Env

- `RENTER_REPLY_BOT_ENABLED` (default `false`) — master switch.
- Reuse `OPENAI_AGENT_MODEL`, `APP_BASE_URL`, `RENTER_INTEREST_TEMPLATE`, `ADMIN_ALERT_PHONES`.

---

## 5. Files touched

| File | Change |
|---|---|
| `lib/outreach/renter-alert.ts` | tag `renter_stage='match_reply'`; status `active` when enabled; update existing-thread path |
| `lib/ai/conversation-orchestrator.ts` | sub-route match-reply → reply-bot (gated) |
| `lib/ai/renter-reply-bot/agent.ts` | new |
| `lib/ai/renter-reply-bot/system-prompt.ts` | new |
| `lib/ai/renter-reply-bot/tools.ts` | new |
| `lib/ai/renter-reply-bot/property-context.ts` | new |
| `lib/outreach/renter-interest.ts` | new — shared `recordRenterInterest()` extracted from the share route |
| `app/api/v1/shares/[token]/interest/route.ts` | call the shared helper |
| `lib/ai/landlord-outreach/agent.ts` | renter guard |
| `.env.example` | document `RENTER_REPLY_BOT_ENABLED` |

## 6. Verification (no test runner)

- `npx tsc --noEmit` clean (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- `npm run build` succeeds.
- Reasoned/manual: with the flag **off**, a renter reply still parks for a human (no behaviour
  change). With it **on**: a reply triggers a safe AI answer; asking "what's the address?" never
  yields the street; "אני מעוניין" alerts staff + sets `interested`; "לא מתאים" records not-interested;
  "תעבירו אותי לנציג" hands off; a hard stop-word still opts out upstream.
- Address-leak check: grep the reply-bot context loader to confirm `street` is never SELECTed.

## 7. Rollout

Ship code with `RENTER_REPLY_BOT_ENABLED` unset (off) — zero behaviour change. Turn on by setting
the env in prod after Phase 1 is live and a couple of real renter replies are observed in the inbox.
