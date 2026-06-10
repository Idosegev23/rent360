-- Mark an approved property "irrelevant" (e.g. rented NOT through us): it leaves the main
-- approved list, moves to an "approved-but-irrelevant" list, and gets a ~1-year recheck reminder
-- to שי/זיו (recheck_at). recheck_reminded_at de-dupes the cron alert.
ALTER TABLE public.approved_properties
  ADD COLUMN IF NOT EXISTS irrelevant_at timestamptz,
  ADD COLUMN IF NOT EXISTS irrelevant_reason text,
  ADD COLUMN IF NOT EXISTS recheck_at date,
  ADD COLUMN IF NOT EXISTS recheck_reminded_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_approved_properties_recheck
  ON public.approved_properties (recheck_at)
  WHERE irrelevant_at IS NOT NULL AND recheck_reminded_at IS NULL;
