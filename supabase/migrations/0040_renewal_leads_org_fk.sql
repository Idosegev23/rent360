-- 0040_renewal_leads_org_fk.sql
-- `renewal_leads.org_id` was declared NOT NULL with no FK in 0038 (the spec's DDL specified
-- `references organizations(id) on delete cascade` — dropped in the shipped migration). Live
-- check: only 3 FKs on the table (property_id, thread_id, message_id), not the spec's 4.
--
-- Verified safe before applying: all 13,463 existing rows carry
-- org_id = '11111111-1111-1111-1111-111111111111', which exists in public.organizations
-- (0 orphan org_id values) — the constraint validates immediately on the full live table.
--
-- Guarded like 0038's own constraints, so re-running this migration is a no-op.
DO $$ BEGIN
  ALTER TABLE public.renewal_leads
    ADD CONSTRAINT renewal_leads_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
