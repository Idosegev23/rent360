-- Tenancy = a renter who actually rented a property through us (a closed deal). This is the
-- foundation for the post-placement loop: link renter↔property↔landlord, then periodically
-- survey the landlord about the tenant → a weighted Tenant Score that feeds renter ranking.
CREATE TABLE IF NOT EXISTS public.tenancies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  renter_id       uuid NOT NULL REFERENCES public.renters(id) ON DELETE CASCADE,
  property_id     uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  match_id        uuid,                        -- the match this closed from, if any
  started_at      date,                        -- lease / move-in start
  monthly_rent    integer,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  ended_at        date,
  notes           text,
  -- landlord survey loop (filled by the survey bot later)
  last_survey_at  timestamptz,
  tenant_score    numeric,                     -- latest weighted Tenant Score (0-100)
  survey_count    integer NOT NULL DEFAULT 0,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- A property is rented to one tenant at a time → at most one ACTIVE tenancy per property.
CREATE UNIQUE INDEX IF NOT EXISTS tenancies_active_property ON public.tenancies (property_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS tenancies_renter ON public.tenancies (renter_id);
CREATE INDEX IF NOT EXISTS tenancies_org ON public.tenancies (org_id);
