# Smart Viewing Scheduler — Phase 3 Design

**Date:** 2026-06-29
**Status:** Approved for build (engine first; goes live after Shai re-consents Google + 2 templates approved)
**Scope:** The 3-way viewing scheduler. When a renter is interested, the system proposes 3 viewing
slots from the **overlap of the agent's free time + the owner's availability**, the renter picks one,
it's booked on the agent's calendar (+ email invites to landlord/renter), and the agent gets a
WhatsApp with the details.

## 1. Confirmed flow (user, REVISED 2026-06-30 — landlord proposes, system filters)

1. **Renter expresses interest** in a property (reply-bot `express_interest`, Phase 2).
2. **System asks the LANDLORD** for possible viewing times (template `viewing_landlord_times_v1`).
3. **Landlord replies (free text)** with a few times → system **parses** them (AI) and **filters
   against the assigned agent's (Shai) calendar free/busy** — keeps only times the agent is free for.
4. **Filtered options → the renter** (free-form interactive buttons — renter is in-window). Renter taps one.
5. **Booked**: event on the agent's Google calendar (`calendar.events` write); `meetings` row (kind=viewing).
6. **Landlord told which time was chosen** (free text — landlord is in-window after step 3).
7. **Renter confirmation** reveals the exact address; **agent (Shai) gets a WhatsApp** with the details
   (template `viewing_agent_scheduled_v1`).

Tradeoff: depends on the landlord replying with times. If they don't, the office already has the lead
(recordRenterInterest fired on interest) and follows up manually; a timeout cron can be added later.

## 2. Hard prerequisites (long lead — start now)

1. **Google `calendar.readonly` re-consent.** Free/busy needs read scope; agents currently have only
   `calendar.events` (write). Add the scope → **every agent reconnects Google once**. Verified: Shai
   (`shay20036@gmail.com`) is connected + active but has only `calendar.events`.
2. **2 new Meta templates** (UTILITY, he) — submitted to Meta (≈1-2 day approval):
   - `viewing_landlord_confirm_v1` — body params: {{1}} location, {{2}} proposed time, {{3}} agent
     name; quick-reply buttons "מאשר/ת" / "לא מתאים". Notifies the landlord + captures confirm.
   - `viewing_agent_scheduled_v1` — body params: {{1}} location, {{2}} time, {{3}} renter (name+phone),
     {{4}} landlord (name+phone); URL button → the thread/meeting. Tells the agent it's booked.
   - The **renter** options message needs no template (free-form interactive, in-window).
3. **Owner availability in a usable form.** Today `properties.owner_viewing_availability` is free text
   (Phase 3 groundwork). The slot engine needs structured windows → parse the free text to structured
   windows (AI, on demand) OR collect structured windows in the landlord bot. v1: parse-on-demand with
   a safe fallback (if unparseable, propose agent-free business-hours slots and lean on the landlord
   confirm in step 5 as the availability gate).

## 3. Building blocks

- `lib/google/freebusy.ts::getCalendarBusy(orgId, userId, from, to)` — busy intervals from the
  agent's primary calendar (`freebusy.query`). Requires the readonly scope.
- `lib/scheduling/slots.ts::suggestSlots(...)` — **pure**: agent busy + constraints (look-ahead days,
  duration, business hours, blocked dates) → up to N spread-out free slots. Owner windows intersect in
  when available.
- State: extend `meetings` (kind='viewing') with a lifecycle — `proposing` → `awaiting_renter_choice`
  → `awaiting_landlord_confirm` → `confirmed` / `cancelled`. Store the proposed slots + the renter's
  pick + the linked thread/renter/property/agent.
- Orchestration (the engine):
  - trigger from `express_interest` (Phase 2 tool) → create a viewing-request, compute slots, send the
    renter the 3 options.
  - renter button reply → record pick → notify+confirm landlord.
  - landlord confirm → create the calendar event + attendees → WhatsApp the agent → mark confirmed.
  - timeouts/fallbacks: no agent free slots → hand to a human; landlord declines → re-propose.

## 4. Build order

1. **Now (foundation, inert until wired):** add `calendar.readonly`; build `freebusy.ts` + `slots.ts`;
   submit the 2 templates; write this spec. Deploy (safe — nothing calls them yet).
2. **Next (engine wiring):** the `viewings` lifecycle + the express_interest→propose→pick→confirm→book
   orchestration + the renter interactive handler + the landlord confirm handler + agent notify.
3. **Go-live:** after Shai reconnects (readonly) + templates approved → end-to-end test against Shai.

## 5. Notes / decisions

- Landlord & renter have no Google connected to us → "3 calendars" = agent's Google event + email
  invites (attendees) + WhatsApp confirmations to both.
- Reuse, don't reinvent: `meetings` table (kind='viewing', outcome), `staff_meeting_reminder_v1` (the
  ~1h-before reminder cron already exists), `recordRenterInterest` (already alerts the office).
- Viewings must respect the same Shabbat/חג rule as sends (no Saturday / Friday-evening slots).
