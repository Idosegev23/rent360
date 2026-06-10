-- Viewings: a meeting that shows a property to a renter, with post-viewing feedback.
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'meeting' CHECK (kind IN ('meeting','viewing')),
  ADD COLUMN IF NOT EXISTS outcome text CHECK (outcome IN ('interested','not_interested','maybe','no_show')),
  ADD COLUMN IF NOT EXISTS feedback text,
  ADD COLUMN IF NOT EXISTS outcome_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_meetings_viewing_feedback
  ON public.meetings (starts_at)
  WHERE kind = 'viewing' AND outcome IS NULL AND status = 'confirmed';
