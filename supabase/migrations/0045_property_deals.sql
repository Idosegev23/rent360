-- Deal control board data (Oct 2026): one row per property holding what the 22-column board needs
-- beyond the property card. Everything on the card (address, owner, rooms, price, assigned agent,
-- tenancy, commission) is read live from its own tables; only the facts that exist nowhere else live here.
-- deal_type is 'rent' for now; 'sale' is reserved for the sales board.

CREATE TABLE IF NOT EXISTS public.property_deals (
  property_id          uuid PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  deal_type            text NOT NULL DEFAULT 'rent',
  work_status          text NOT NULL DEFAULT 'new_recruit',
  status_changed_at    timestamptz NOT NULL DEFAULT now(),

  recruited_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,   -- יועץ מגייס (the handling agent is properties.assigned_agent_user_id)
  recruit_source       text,
  recruited_at         date,

  expected_close_date  date,
  closing_price        integer,
  deal_renter_name     text,
  deal_renter_phone    text,
  signing_date         date,
  docs_status          text NOT NULL DEFAULT 'not_started',

  expected_fee         integer,          -- ₪ override; NULL = derived from the agreed commission / rent
  payment_status       text NOT NULL DEFAULT 'pending',
  payment_method       text,
  invoice_number       text,
  collected_at         date,

  note                 text,
  updated_by           uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.property_deals ADD CONSTRAINT property_deals_type_chk CHECK (deal_type IN ('rent','sale'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.property_deals ADD CONSTRAINT property_deals_status_chk CHECK (work_status IN (
    'new_recruit','photo_publish','tours_marketing','offer_submitted','negotiation_draft',
    'docs_check','contract_signing','closed_paid','frozen_cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.property_deals ADD CONSTRAINT property_deals_source_chk CHECK (recruit_source IS NULL OR recruit_source IN (
    'yad2','nadlan_one','facebook','past_client','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.property_deals ADD CONSTRAINT property_deals_docs_chk CHECK (docs_status IN ('not_started','in_review','missing','approved'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.property_deals ADD CONSTRAINT property_deals_payment_chk CHECK (payment_status IN ('pending','collected','waived'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.property_deals ADD CONSTRAINT property_deals_method_chk CHECK (payment_method IS NULL OR payment_method IN ('bank_transfer','cash','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS property_deals_org_status_idx ON public.property_deals (org_id, work_status);
CREATE INDEX IF NOT EXISTS property_deals_org_recruiter_idx ON public.property_deals (org_id, recruited_by_user_id);

DROP TRIGGER IF EXISTS trg_property_deals_updated_at ON public.property_deals;
CREATE TRIGGER trg_property_deals_updated_at BEFORE UPDATE ON public.property_deals
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.property_deals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_all_property_deals ON public.property_deals;
CREATE POLICY org_all_property_deals ON public.property_deals
  FOR ALL USING (org_id = public.jwt_org_id()) WITH CHECK (org_id = public.jwt_org_id());
