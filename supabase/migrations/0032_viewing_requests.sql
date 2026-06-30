-- 0032_viewing_requests.sql
-- Lifecycle state for the smart 3-way viewing scheduler (Phase 3 engine). A row tracks one
-- renter↔property viewing being coordinated: propose slots → renter picks → landlord confirms →
-- booked (a confirmed `meetings` row + Google event). `meetings` stays the confirmed-event table.
create table if not exists public.viewing_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  renter_id uuid,
  property_id uuid,
  agent_user_id uuid,           -- whose Google calendar we read/write (assigned agent)
  renter_thread_id uuid,
  landlord_thread_id uuid,
  status text not null default 'proposing',
    -- proposing | awaiting_renter | awaiting_landlord | confirmed | cancelled | failed
  proposed_slots jsonb not null default '[]'::jsonb,  -- [{start,end} ISO, ...]
  chosen_slot jsonb,                                  -- {start,end}
  meeting_id uuid,
  google_event_id text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_viewing_requests_org_status on public.viewing_requests (org_id, status);
create index if not exists idx_viewing_requests_renter_thread on public.viewing_requests (renter_thread_id) where status = 'awaiting_renter';
create index if not exists idx_viewing_requests_landlord_thread on public.viewing_requests (landlord_thread_id) where status = 'awaiting_landlord';

alter table public.viewing_requests enable row level security;
-- service-role only (the engine runs server-side); no public policies.
