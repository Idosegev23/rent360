-- 0021: Activity — polymorphic notes/timeline attached to any entity (property/renter/thread/…).
-- Append-only log. Additive + idempotent.

CREATE TABLE IF NOT EXISTS public.activity (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL,
  entity_type    text NOT NULL,                 -- property | renter | thread | tenancy | task | meeting | contact
  entity_id      uuid NOT NULL,
  author_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,  -- null = system
  kind           text NOT NULL DEFAULT 'note',  -- note | call | whatsapp | email | status_change | task | meeting | system
  body           text,
  metadata       jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_entity ON public.activity (org_id, entity_type, entity_id, created_at DESC);

ALTER TABLE public.activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_all_activity ON public.activity;
CREATE POLICY org_all_activity ON public.activity
  FOR ALL USING (org_id = public.jwt_org_id()) WITH CHECK (org_id = public.jwt_org_id());
