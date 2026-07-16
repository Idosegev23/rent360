# Renter Edit ("ערוך פרטים") — Design

**Date:** 2026-07-15 · **Status:** Approved.

## Goal
Let the operator edit a renter's questionnaire data from the admin (the answers are read-only today),
so e.g. a renter who wants to change their search area can be updated. Landlord/owner editing already
exists (`EditPropertyDialog` → "ערוך פרטים" on the property page) — no work there.

## Server — extend `PATCH /api/v1/renters/[id]`
Today the PATCH whitelists only CRM fields (lead_status/source/rating/approved_budget/assigned_to).
Add the full questionnaire field set, validated + coerced the same way the public submit route does:
- **text/enum:** first_name, last_name, email, employer, notes, move_in_date, contract_length
  (6|12|flexible), top_floor_preference (any|yes|no), condition_preference (renovated|good|needs-work|
  any), household_type (single|couple|family|roommates|students|other), employment_status
  (employed|self_employed|student|other). Empty string → null; invalid enum → 400.
- **int:** budget_min/max, budget_flexibility, vaad_bayit_max, arnona_max, min_sqm, floor_min/max,
  household_size, children_count.
- **num:** preferred_rooms. **bool:** rooms_flexible, move_in_flexible, has_children, has_pets,
  smokers, has_payslips, has_security_checks, has_guarantors.
- **string[]:** preferred_cities, preferred_neighborhoods.
- **preferences (jsonb):** sanitized to the known shape — per-amenity `{level: must|nice|any}` with
  sub-options (parking.type, balcony.min_sqm, furnished/aircon.amount, accessibility.type), the
  wanted-toggles (storage/solar_heater/bars/quiet/fiber_internet/shelter `{wanted}`), and
  `divided_ok` boolean. Unknown keys dropped.

Unknown top-level keys ignored (as today). After a save that touched any **matchable** field (i.e.
anything except pure identity: first_name/last_name/email), fire `computeMatchesInBackground({renterId})`
so matches refresh. CRM-only edits do NOT recompute (unchanged behavior).

## UI — `components/renters/RenterEditDialog.tsx`
Mirror `EditPropertyDialog`: an "ערוך פרטים" button near the top of the renter page opens a modal with
sectioned fields (זהות, מיקום, תקציב, דירה, כניסה, משק בית, תעסוקה, העדפות, הערות). PATCHes the renter,
then `onSaved` reloads the page. Cities/neighborhoods edited as comma-separated tag inputs (matcher
canonicalizes). Preferences section: a compact per-amenity row (level select + sub-option) mirroring
the questionnaire so the saved jsonb matches what the matcher reads. Gender-neutral Hebrew.

## No DB change — all columns already exist.

## Acceptance
1. "ערוך פרטים" on the renter page opens the dialog pre-filled with current values.
2. Changing search area (cities/neighborhoods) + saving persists and refreshes matches.
3. Editing preferences (e.g. parking must→any) persists the correct jsonb shape; a must-have change
   re-disqualifies/qualifies properties on recompute.
4. Invalid enum → 400, no write. CRM-only PATCH (from the lead panel) still does not recompute.
