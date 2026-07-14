-- Renter CRM layer: pipeline stage, acquisition source, internal rating, vetted budget, owning agent.
-- All additive + idempotent. Sits on top of the questionnaire data in `renters`.
ALTER TABLE public.renters
  ADD COLUMN IF NOT EXISTS lead_status text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS rating smallint,
  ADD COLUMN IF NOT EXISTS approved_budget integer,
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- Allowed pipeline stages. Guarded so a bad write from anywhere fails loudly.
DO $$ BEGIN
  ALTER TABLE public.renters
    ADD CONSTRAINT renters_lead_status_chk
    CHECK (lead_status IN ('new','contacted','qualified','viewing','negotiating','placed','lost'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.renters
    ADD CONSTRAINT renters_rating_chk
    CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_renters_lead_status ON public.renters (lead_status);
CREATE INDEX IF NOT EXISTS idx_renters_assigned_to ON public.renters (assigned_to);

COMMENT ON COLUMN public.renters.lead_status IS 'Pipeline stage: new/contacted/qualified/viewing/negotiating/placed/lost.';
COMMENT ON COLUMN public.renters.source IS 'Acquisition source: facebook/whatsapp/referral/manual/website/other. NULL = unknown.';
COMMENT ON COLUMN public.renters.rating IS 'Internal 1-5 quality/priority rating. NULL = unrated.';
COMMENT ON COLUMN public.renters.approved_budget IS 'Vetted/approved monthly budget (₪), distinct from the stated budget_max.';
COMMENT ON COLUMN public.renters.assigned_to IS 'Owning staff user (users.id). NULL = unassigned.';
