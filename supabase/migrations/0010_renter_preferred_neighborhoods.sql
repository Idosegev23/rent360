-- Adds a per-renter neighborhood preference list. Empty array means the
-- renter didn't specify any — the matching engine treats this as "neutral"
-- on the neighborhood dimension so existing renters aren't penalized.
ALTER TABLE renters
  ADD COLUMN IF NOT EXISTS preferred_neighborhoods jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN renters.preferred_neighborhoods IS
  'Optional array of preferred neighborhood names. Empty array = no neighborhood preference (neutral in matching).';
