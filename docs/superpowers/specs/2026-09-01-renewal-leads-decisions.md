# Renewal leads — decisions made during implementation

**Date:** 2026-09-01 · Branch `feature/renewal-leads` · Spec: `2026-09-01-renewal-leads-design.md`

Seventeen decisions taken while executing the plan, kept because several correct a defect in the
spec itself and the reasoning would otherwise be lost. Each records what was decided, why, and what
it costs if the decision was wrong.

## Defects found in the plan before any code was written

**R1 — record field names vs. property column names.** The plan looped over a shared name list to
build the update patch, but the merge module has no `price` (it is `priceLast`) and no `type` (it is
`kind`). Mapped explicitly instead. *Cost if wrong:* `price` and `type` silently null on backfilled
rows.

**R2 — `scraped_metadata` missing from the SELECT.** The update patch spread
`existing.scraped_metadata`, which the plan's SELECT never fetched. Left unfixed this would have
overwritten existing metadata with `undefined` across ~9,300 production rows and destroyed the
`previous_phone` audit trail. *Cost if wrong:* irreversible metadata loss.

**R3 — undefined `normalize()`.** The patch builder called a function that was never defined.
Resolved to `parsePhones` from the merge module, leading-zero form, for comparison against
`properties.contact_phone`.

**R4 / R4b — the suppression check could never match, in two places.** `whatsapp_suppression` stores
E.164 without a plus (`972502011474`); the export yields leading-zero (`0502011474`). R4 fixed the
SQL assertion (compare the last 9 digits); **R4b found the same bug in the runtime gate** — the
import's suppression `Set` membership test, which would have returned false for every lead. *Cost if
wrong:* every opted-out owner enters the queue and can be messaged. The highest-consequence defect
found in this work. The live import reported 63 suppressed skips, confirming the gate fires.

**R5 — preview would have fired one query per row.** Added a pure `renewalVarsFromRow(row,
timesListed)` so the queue builds ~256 previews from data it has already joined.

**R6 — address cleaning must not fork.** `cleanCity`/`cleanStreet` in `personalization.ts` were
exported for reuse rather than copied. That file is on the live landlord path; the change is two
`export` keywords and no behaviour change. `cleanCity` matters more than it looks — 1,044 imported
rows carry `city = 'חיפה - מגורים'`.

**R7 — undefined date helpers.** Defined inline in the queue route.

## Corrections to the spec's own numbers and rules

**R10 — the overlap figures were wrong by 2,076 rows.** The spec's 6,201-new / 7,262-existing split
came from a query filtering `city IN (…10 spellings…)`, written to answer a different question. The
import matches on `external_id` alone, because `properties_external_id_unique` is global. The filter
dropped rows whose city string is dirty but in-region: `חיפה - מגורים` 1,044, `קרית חיים` 655 (a
Haifa neighbourhood stored as a city), plus the other `- מגורים` variants. Corrected to **4,125
create / 9,338 update / 35 approved-skips**, coverage 6,744/12,076 (55.8%) → 14,746/16,201 (91.0%).

**R12 — the due window returned zero leads.** The spec defined `[today-45, today]` while
simultaneously claiming 259 leads were due. Both cannot hold: the earliest `matures_at` is
2026-09-13. Corrected to **`[today-45, today+30]`**, which returns exactly 259. The forward half is
also the business-correct rule — the tenancy began when the listing came down, so the renewal
decision is made shortly *before* the anniversary, and a backward-only window always arrives late.

**R9 — `phoneKind` taxonomy.** `072`/`073`/`077` are Israeli non-geographic/VOIP prefixes;
`046`/`048`/`049`/`03x`/`09x` are geographic landlines. An earlier throwaway artifact labelled only a
literal `073` as VOIP; the code is deliberately more correct. Nothing gates on `phoneKind`.

## Design decisions

**R11 — the snapshot must cover every column the import can write,** not only the 8 protected ones.
A protected-column snapshot proves no harm was done but leaves no undo for what is deliberately
changed. Later hardened further: `normalizeUpdateRow` asserts its emitted keys against
`UPDATE_WRITE_COLUMNS` at runtime and throws if they drift.

**R13 — the preview renders from the DB template body, never a hardcoded copy.**
`renderRenewalPreview` takes the body as a string parameter; the route reads `body_template` from
`whatsapp_templates` once per request. *Cost if wrong:* the operator reviews one text while the
landlord receives another, with no signal that they diverged.

**R15 — migration 0039 (aggregates RPC) accepted although it was not in the plan.** PostgREST on this
project has aggregate functions disabled (`PGRST123`) and its grammar has no `GROUP BY`, so the four
pipeline aggregates could only be computed by fetching all 13,463 rows — which the plan forbids. The
function filters `org_id`, is SECURITY INVOKER, and is granted only to `service_role`, mirroring the
existing `renter_send_counts` RPC.

**R16 — the API routes had to be exercised over real HTTP.** Five routes were about to ship having
never executed; a session was minted from the service-role key for read-only GET verification.

## Safety fixes made outside the plan's scope

**R14 — `canSendNow` failed OPEN on Shabbat.** On a Hebcal fetch error with a cold cache it returned
no blocked windows, leaving only the hour gate — a Saturday batch during an outage would have sent,
violating an absolute project rule. Now falls back to a conservative Israel-local Friday 12:00 →
Saturday 20:30 block, reachable only in that outage case. **Yom Tov remains uncovered during an
outage** — a documented, accepted gap, not an oversight. This file is shared with the live
renter-alert and reminder crons; the change can only block more, never less.

**R17 — one extra fix round past the process cap,** to close a confirmed path where a delivered
WhatsApp message could be sent twice: `sendTemplate` succeeded, thread bookkeeping then failed, the
lead stayed `pending`, and the next batch re-dispatched it. Now `upsertThread` recovers from the
likely race by re-running its SELECT, and all post-send bookkeeping is wrapped so the lead is stamped
`sent` regardless — a delivered message is never resent.

**R8 — environment, not code.** `npm run lint` is broken by a stray `/Users/idosegev/eslint.config.js`
(May 2025) importing an uninstalled `@eslint/js`; ESLint walks out of the repo and dies. Verified as
`ESLINT_USE_FLAT_CONFIG=false npm run lint` throughout. Worth deleting that file — it breaks lint in
every project on this machine.

## Known residuals, carried deliberately

1. **Yom Tov during a cold-cache Hebcal outage** is not blocked by the fallback (R14).
2. **March 2026 is missing from the source export** — ~1,000 leads that would mature in March 2027.
   Surfaced in the pipeline chart as an explicit "אין נתונים" row rather than hidden. Worth
   requesting a re-export for that month alone.
3. **`lib/outreach/dispatcher.ts` (live landlord path) retains the resend weakness** R17 fixed for
   renewals. It inherits the shared `threads.ts` race recovery but not the post-send wrapping.
4. **`app/outreach/page.tsx` uses masculine-singular imperative button labels** (`שלח`, `בחר הכל`,
   `סנן`), against the project's gender-neutral rule. Not changed — out of scope for this branch.
5. **A `viewer`-role account can POST `send-batch`.** `requireAdminOrg()` only requires a
   `users.org_id` row. Identical to the pre-existing landlord routes — consistent, not a regression,
   but worth a policy decision now that a 12,906-lead cold-outreach queue exists.
6. **rent360's own external scraper ingests this same Nadlan One feed and discards the movement
   dates** — the root cause of the missing delist data this import worked around.
