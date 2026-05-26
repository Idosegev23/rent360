-- 0008_matches_renter_id.sql
-- Repurpose the legacy `matches` table (built for `leads`, removed in earlier session)
-- to store renter↔property match scores. The `renters` table is the new source of
-- truth; `lead_id` stays nullable for backward-compat.
-- Applied 2026-05-26 via Supabase MCP.

alter table public.matches
  alter column lead_id drop not null,
  add column if not exists renter_id uuid references public.renters(id) on delete cascade,
  add column if not exists is_disqualified boolean not null default false,
  add column if not exists disqualifying_reasons jsonb,
  add column if not exists breakdown jsonb,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_matches_unique_renter_property
  on public.matches(org_id, renter_id, property_id)
  where renter_id is not null;

create index if not exists idx_matches_property_score
  on public.matches(property_id, score desc nulls last);

create index if not exists idx_matches_renter_score
  on public.matches(renter_id, score desc nulls last)
  where renter_id is not null;
