-- Public Facebook onboarding submissions (renter or landlord). Audit + dedupe trail for the
-- /join public forms. The renter/landlord records they create live in `renters` / `properties`;
-- this table keeps the raw submission + what it produced. Additive + idempotent.
CREATE TABLE IF NOT EXISTS public.onboarding_submissions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  audience            text NOT NULL,
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_name        text,
  contact_phone       text,
  city                text,
  created_renter_id   uuid,
  created_property_id uuid,
  status              text NOT NULL DEFAULT 'received',
  ip                  text,
  user_agent          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.onboarding_submissions
    ADD CONSTRAINT onboarding_submissions_audience_chk CHECK (audience IN ('renter','landlord'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_onboarding_submissions_phone ON public.onboarding_submissions (contact_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_submissions_org ON public.onboarding_submissions (org_id, created_at DESC);

ALTER TABLE public.onboarding_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_all_onboarding_submissions ON public.onboarding_submissions;
CREATE POLICY org_all_onboarding_submissions ON public.onboarding_submissions
  FOR ALL USING (org_id = public.jwt_org_id()) WITH CHECK (org_id = public.jwt_org_id());
