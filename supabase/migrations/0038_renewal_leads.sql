-- Renewal-lead campaign built on the Nadlan One historical export. `properties` stays the
-- property entity (upsert on external_id, which IS the Nadlan One id); this table holds only
-- campaign lifecycle so re-running a campaign never mutates property state.
-- Maturity is a date query (matures_at = delisted_at + 365), not a state machine.
CREATE TABLE IF NOT EXISTS public.renewal_leads (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL,
  property_id           uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  source                text NOT NULL DEFAULT 'nadlanone',
  external_id           text NOT NULL,

  delisted_at           date NOT NULL,
  -- Detection-sweep timestamp, NOT the real delist moment: 27,560 delist movements in the
  -- source share only 344 distinct timestamps (1,213 properties at 2025-11-16T00:23:10).
  -- The day is accurate to ~±1-2 days. Never present this as an exact time.
  delisted_observed_at  timestamptz,
  first_listed_at       date,
  matures_at            date NOT NULL,

  days_on_market        int,
  times_listed          int NOT NULL DEFAULT 1,
  price_first           int,
  price_last            int,
  price_change_pct      numeric(5,1),

  -- Snapshot of the listing at export time (immutable facts, not live property state) so the
  -- browse page filters/sorts 13k rows without a join.
  city                  text,
  street                text,
  segment               text NOT NULL,
  score                 int NOT NULL DEFAULT 0,
  is_private_owner      boolean NOT NULL DEFAULT true,
  phone_kind            text,
  phone_alt             text,

  -- v1 writes: pending | sent | skipped. Reserved for outcome tracking: replied | won | lost.
  status                text NOT NULL DEFAULT 'pending',
  skip_reason           text,
  sent_at               timestamptz,
  thread_id             uuid REFERENCES public.threads(id) ON DELETE SET NULL,
  message_id            uuid REFERENCES public.messages(id) ON DELETE SET NULL,

  timeline              jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.renewal_leads
    ADD CONSTRAINT renewal_leads_org_external_unique UNIQUE (org_id, external_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.renewal_leads
    ADD CONSTRAINT renewal_leads_segment_chk CHECK (segment IN ('private_once','repeat'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.renewal_leads
    ADD CONSTRAINT renewal_leads_status_chk
    CHECK (status IN ('pending','sent','skipped','replied','won','lost'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS renewal_leads_due_idx   ON public.renewal_leads (org_id, status, matures_at);
CREATE INDEX IF NOT EXISTS renewal_leads_score_idx ON public.renewal_leads (org_id, score DESC);
CREATE INDEX IF NOT EXISTS renewal_leads_city_idx  ON public.renewal_leads (org_id, city);
CREATE INDEX IF NOT EXISTS renewal_leads_prop_idx  ON public.renewal_leads (property_id);

ALTER TABLE public.renewal_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_all_renewal_leads ON public.renewal_leads;
CREATE POLICY org_all_renewal_leads ON public.renewal_leads
  FOR ALL USING (org_id = public.jwt_org_id()) WITH CHECK (org_id = public.jwt_org_id());
