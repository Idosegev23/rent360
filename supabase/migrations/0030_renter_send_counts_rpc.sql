-- 0030_renter_send_counts_rpc.sql
-- Aggregate RPC for the unified per-renter send counter (design §4.2).
-- Returns one row per renter (today/total notified-match counts) instead of
-- materializing the underlying match rows. A row-materializing count query would
-- silently hit PostgREST's 1000-row default response cap once the all-time
-- notified-match count across a page of renters exceeds 1000 (renter_notified_at
-- is monotonic — only ever set, never reset), under-reporting the badge. Counting
-- DB-side keeps the result <= one row per renter (<= 200 per list page), so it can
-- never be truncated.

create or replace function public.renter_send_counts(
  p_org_id uuid,
  p_renter_ids uuid[],
  p_day_start timestamptz
)
returns table (
  renter_id uuid,
  today bigint,
  total bigint
)
language sql stable as $$
  select
    m.renter_id,
    count(*) filter (where m.renter_notified_at >= p_day_start) as today,
    count(*) as total
  from public.matches m
  where m.org_id = p_org_id
    and m.renter_id = any(p_renter_ids)
    and m.renter_notified_at is not null
  group by m.renter_id;
$$;

revoke all on function public.renter_send_counts(uuid, uuid[], timestamptz) from public;
grant execute on function public.renter_send_counts(uuid, uuid[], timestamptz) to service_role;
