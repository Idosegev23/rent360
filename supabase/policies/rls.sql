-- Enable RLS and define policies based on JWT org_id

alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.api_keys enable row level security;
alter table public.properties enable row level security;
alter table public.leads enable row level security;
alter table public.matches enable row level security;
alter table public.threads enable row level security;
alter table public.messages enable row level security;
alter table public.imports enable row level security;
alter table public.webhooks enable row level security;
alter table public.inbound_events enable row level security;
alter table public.settings enable row level security;
alter table public.audit_log enable row level security;

-- Helper to extract org_id from JWT
create or replace function public.jwt_org_id() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'org_id', '')::uuid
$$;

-- Generic org-based policy: row org_id must equal jwt org_id
create policy org_select on public.organizations for select using (true);
create policy org_all_users on public.users for all using (org_id = public.jwt_org_id()) with check (org_id = public.jwt_org_id());
create policy org_all_api_keys on public.api_keys for all using (org_id = public.jwt_org_id()) with check (org_id = public.jwt_org_id());
create policy org_all_properties on public.properties for all using (org_id = public.jwt_org_id()) with check (org_id = public.jwt_org_id());
create policy org_all_leads on public.leads for all using (org_id = public.jwt_org_id()) with check (org_id = public.jwt_org_id());
create policy org_all_matches on public.matches for all using (org_id = public.jwt_org_id()) with check (org_id = public.jwt_org_id());
create policy org_all_threads on public.threads for all using (org_id = public.jwt_org_id()) with check (org_id = public.jwt_org_id());
create policy org_all_messages on public.messages for all using (org_id = public.jwt_org_id()) with check (org_id = public.jwt_org_id());
create policy org_all_imports on public.imports for all using (org_id = public.jwt_org_id()) with check (org_id = public.jwt_org_id());
create policy org_all_webhooks on public.webhooks for all using (org_id = public.jwt_org_id()) with check (org_id = public.jwt_org_id());
create policy org_all_inbound on public.inbound_events for all using (org_id = public.jwt_org_id()) with check (org_id = public.jwt_org_id());
create policy org_all_settings on public.settings for all using (org_id = public.jwt_org_id()) with check (org_id = public.jwt_org_id());
create policy org_all_audit on public.audit_log for all using (org_id = public.jwt_org_id()) with check (org_id = public.jwt_org_id());
