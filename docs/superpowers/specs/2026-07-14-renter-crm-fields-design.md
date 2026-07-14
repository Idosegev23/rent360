# Renter CRM Fields (Module D) — Design

**Date:** 2026-07-14 · **Status:** Approved (build second, after escalation)

## Goal
Give each renter a lightweight CRM layer on top of the questionnaire data: where they came from,
where they are in the pipeline, how promising they are, their vetted budget, and who owns them.

## Schema — migration `0035_renter_crm_fields.sql` (additive, idempotent)
`ALTER TABLE public.renters ADD COLUMN IF NOT EXISTS`:
- `lead_status text NOT NULL DEFAULT 'new'` — CHECK in
  (`new`,`contacted`,`qualified`,`viewing`,`negotiating`,`placed`,`lost`). Existing rows → `new`.
- `source text` (nullable) — `facebook`,`whatsapp`,`referral`,`manual`,`website`,`other`. Module B
  sets `facebook`. Left NULL (unknown) for existing rows.
- `rating smallint` (nullable) — CHECK 1..5.
- `approved_budget integer` (nullable) — vetted budget, distinct from the stated `budget_max`.
- `assigned_to uuid` (nullable) REFERENCES `users(id)` ON DELETE SET NULL — owning agent.

Index: `idx_renters_lead_status (lead_status)` and `idx_renters_assigned_to (assigned_to)` for future
pipeline/owner filters. Applied via Supabase MCP (project ref sjecwkuztpoqpunlpxfe).

## API — `app/api/v1/renters/[id]/route.ts`
- GET already `select('*')` → the new fields ride along, no change.
- Add **PATCH** (auth via `requireOrg()`): accepts a whitelisted subset
  `{ lead_status?, source?, rating?, approved_budget?, assigned_to? }`, validates each
  (enum membership, 1..5, integer ≥ 0, uuid-or-null), updates the org's renter, returns the row.
  Unknown keys ignored. Empty string → NULL for the nullable fields.

## UI — `components/renters/LeadManagementPanel.tsx` (client)
Mounted on the renter page right after `<NotesBanner>`. Props: `renterId`, initial values from the
loaded `renter`, `onSaved` (calls the page's `load()`).
- **סטטוס** — segmented/select of the 7 lead_status values (Hebrew labels).
- **דירוג** — 1–5 stars.
- **מקור** — select of the 6 sources.
- **תקציב מאושר** — number input (₪), shown next to the stated budget for contrast.
- **שיוך** — select of active staff (`GET /api/v1/team` → members).
Auto-saves each control via PATCH (optimistic + toast/checkmark), matching the AgreedCommission
save pattern. Gender-neutral Hebrew.

## Acceptance
1. Migration applied; the 5 columns exist; existing renters show `lead_status='new'`, others NULL.
2. Changing status/rating/source/budget/owner on the renter page persists (reload shows it).
3. PATCH rejects a bad enum/rating with 400 and does not write.
4. `assigned_to` dropdown lists active staff; selecting one and reloading keeps it.
