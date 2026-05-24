-- 0006_vector_rpcs.sql
-- RPC functions used by the AI agent tools `search_property_context` and
-- `search_past_conversations`. Applied 2026-05-20 via Supabase MCP.

create or replace function public.match_properties(
  query_embedding vector(1536),
  match_org_id uuid,
  match_property_id uuid default null,
  match_count int default 5
)
returns table (
  id uuid,
  title text,
  city text,
  neighborhood text,
  address text,
  price int,
  rooms real,
  sqm int,
  description text,
  full_text text,
  similarity float
)
language sql stable as $$
  select
    p.id, p.title, p.city, p.neighborhood, p.address,
    p.price, p.rooms, p.sqm, p.description, p.full_text,
    1 - (p.embedding <=> query_embedding) as similarity
  from public.properties p
  where p.org_id = match_org_id
    and p.embedding is not null
    and (match_property_id is null or p.id = match_property_id)
  order by p.embedding <=> query_embedding
  limit greatest(1, least(match_count, 25));
$$;

create or replace function public.match_messages(
  query_embedding vector(1536),
  match_org_id uuid,
  match_thread_id uuid default null,
  match_phone text default null,
  match_count int default 5
)
returns table (
  id uuid,
  thread_id uuid,
  direction text,
  body text,
  created_at timestamptz,
  similarity float
)
language sql stable as $$
  select
    m.id, m.thread_id, m.direction, m.body, m.created_at,
    1 - (m.embedding <=> query_embedding) as similarity
  from public.messages m
  left join public.threads t on t.id = m.thread_id
  where m.org_id = match_org_id
    and m.embedding is not null
    and m.body is not null
    and (match_thread_id is null or m.thread_id = match_thread_id)
    and (match_phone is null or t.phone = match_phone)
  order by m.embedding <=> query_embedding
  limit greatest(1, least(match_count, 25));
$$;

revoke all on function public.match_properties(vector, uuid, uuid, int) from public;
revoke all on function public.match_messages(vector, uuid, uuid, text, int) from public;
grant execute on function public.match_properties(vector, uuid, uuid, int) to service_role;
grant execute on function public.match_messages(vector, uuid, uuid, text, int) to service_role;
