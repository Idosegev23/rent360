-- Commission tracking on closed deals + a documents vault (link-based) per entity.
ALTER TABLE public.tenancies
  ADD COLUMN IF NOT EXISTS commission_amount numeric,
  ADD COLUMN IF NOT EXISTS commission_status text NOT NULL DEFAULT 'pending' CHECK (commission_status IN ('pending','collected','waived')),
  ADD COLUMN IF NOT EXISTS commission_collected_at timestamptz;

CREATE TABLE IF NOT EXISTS public.documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('property','renter','tenancy','thread')),
  entity_id   uuid NOT NULL,
  name        text NOT NULL,
  url         text NOT NULL,
  kind        text,
  created_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_entity ON public.documents (org_id, entity_type, entity_id, created_at DESC);
-- RLS in supabase/policies/rls.sql (org_all_documents).
