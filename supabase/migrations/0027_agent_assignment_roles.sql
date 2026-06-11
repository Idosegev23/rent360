-- 'office' role (משרד), per-property agent assignment, and a "handles properties" flag
-- (the agents that properties get assigned to — currently שי + זיו).
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('owner','admin','agent','office','viewer'));
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS handles_properties boolean NOT NULL DEFAULT false;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS assigned_agent_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_properties_assigned_agent ON public.properties (org_id, assigned_agent_user_id);
