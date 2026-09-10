-- Agent deal board (spec: docs/superpowers/specs/2026-09-10-agent-deal-board-design.md).
-- Agent-owned working stage per property + monthly targets. Complements /pipeline, which stays a
-- derived read-only funnel. Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.deal_stages (
  property_id      uuid PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  stage            text NOT NULL,
  -- Reset ONLY when the stage changes. A note edit must never make a stuck deal look fresh.
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  note             text,
  updated_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.deal_stages ADD CONSTRAINT deal_stages_stage_chk
    CHECK (stage IN ('new','waiting_owner','scheduling_viewing','viewed','docs_pending','signed','stuck'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS deal_stages_org_stage_idx ON public.deal_stages (org_id, stage);

ALTER TABLE public.deal_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_all_deal_stages ON public.deal_stages;
CREATE POLICY org_all_deal_stages ON public.deal_stages
  FOR ALL USING (org_id = public.jwt_org_id()) WITH CHECK (org_id = public.jwt_org_id());

CREATE TABLE IF NOT EXISTS public.agent_targets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  month             date NOT NULL,
  target_deals      int  NOT NULL DEFAULT 0,
  target_commission int  NOT NULL DEFAULT 0,   -- ₪, VAT-inclusive, same basis as tenancies.commission_amount
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.agent_targets ADD CONSTRAINT agent_targets_org_user_month_unique UNIQUE (org_id, user_id, month);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.agent_targets ADD CONSTRAINT agent_targets_month_is_first_chk CHECK (EXTRACT(DAY FROM month) = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.agent_targets ADD CONSTRAINT agent_targets_nonneg_chk CHECK (target_deals >= 0 AND target_commission >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.agent_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_all_agent_targets ON public.agent_targets;
CREATE POLICY org_all_agent_targets ON public.agent_targets
  FOR ALL USING (org_id = public.jwt_org_id()) WITH CHECK (org_id = public.jwt_org_id());
