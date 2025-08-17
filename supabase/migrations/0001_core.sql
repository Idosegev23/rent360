-- Core schema for Rent360
create extension if not exists pgcrypto;

-- organizations
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- users
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text,
  email text,
  phone text,
  role text not null check (role in ('owner','admin','agent','viewer')),
  created_at timestamptz not null default now()
);

-- api_keys
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  source_id text,
  name text,
  scopes text[],
  hashed_key text,
  ip_allowlist text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- properties
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  external_id text,
  title text not null,
  city text not null,
  neighborhood text,
  address text,
  price integer not null,
  rooms integer,
  sqm integer,
  amenities jsonb,
  available_from date,
  link text,
  images jsonb,
  source text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- leads
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  external_id text,
  source_id text,
  full_name text,
  phone text,
  email text,
  budget_min integer,
  budget_max integer,
  preferred_cities jsonb,
  preferred_rooms integer,
  must_haves jsonb,
  nice_to_haves jsonb,
  move_in_from date,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- matches
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  score numeric,
  reasons jsonb,
  status text,
  created_at timestamptz not null default now()
);

-- threads
create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid,
  property_id uuid,
  last_message_at timestamptz,
  tags jsonb
);

-- messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  thread_id uuid references public.threads(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  channel text,
  direction text,
  body text,
  attachments jsonb,
  status text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- imports
create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  source text,
  type text,
  file_ref text,
  total int,
  success int,
  failed int,
  mapping jsonb,
  ran_at timestamptz,
  log text
);

-- webhooks
create table if not exists public.webhooks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  url text,
  secret text,
  event_types text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- inbound_events
create table if not exists public.inbound_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  source_id text,
  endpoint text,
  payload jsonb,
  status text,
  reason text,
  idempotency_key text not null,
  created_at timestamptz not null default now()
);

-- settings
create table if not exists public.settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  matching_weights jsonb,
  quiet_hours jsonb,
  messaging_defaults jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- audit_log
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid,
  action text,
  entity text,
  entity_id uuid,
  diff jsonb,
  created_at timestamptz not null default now()
);

-- indexes
create index if not exists idx_leads_phone_org on public.leads(phone, org_id);
create index if not exists idx_properties_org_city_price on public.properties(org_id, city, price);
create index if not exists idx_matches_lead_score on public.matches(lead_id, score desc);

-- unique constraints / dedupe aids
create unique index if not exists uq_leads_org_source_phone on public.leads(org_id, source_id, phone);
create unique index if not exists uq_leads_org_external on public.leads(org_id, external_id) where external_id is not null;
create unique index if not exists uq_properties_org_external on public.properties(org_id, external_id) where external_id is not null;

-- triggers for updated_at
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_leads_updated_at
before update on public.leads
for each row execute procedure public.set_updated_at();

create trigger trg_properties_updated_at
before update on public.properties
for each row execute procedure public.set_updated_at();
