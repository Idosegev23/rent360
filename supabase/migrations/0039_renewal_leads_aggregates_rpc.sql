-- 0039_renewal_leads_aggregates_rpc.sql
-- Aggregate RPC for the renewal-leads pipeline browser (Task 8, /api/v1/renewals/pipeline).
-- PostgREST on this project has aggregate functions disabled (`select=city,count()` returns
-- PGRST123 "Use of aggregate functions is not allowed" — confirmed live), and there is no
-- GROUP BY in the PostgREST filter/select grammar, so the four `aggregates` (byMonth, byGrade,
-- byCity, bySegment) cannot be computed by the supabase-js client without either fetching all
-- 13,463+ rows (explicitly ruled out) or grouping DB-side. Same shape as the existing
-- `renter_send_counts` RPC (migration 0030): one round trip, grouped in SQL.
--
-- Takes the SAME optional filters as the pipeline route's row query (everything except `page`),
-- so `aggregates` reflects the same filtered subset as `rows`/`total` — with no filters passed,
-- it's the full-table breakdown (13,463 rows across all `renewal_leads` for the org).

create or replace function public.renewal_leads_aggregates(
  p_org_id uuid,
  p_city text default null,
  p_grade text default null,
  p_segment text default null,
  p_status text default null,
  p_q text default null
)
returns jsonb
language sql stable as $$
  with filtered as (
    select matures_at, score, city, segment
    from public.renewal_leads
    where org_id = p_org_id
      and (p_city is null or city = p_city)
      and (p_segment is null or segment = p_segment)
      and (p_status is null or status = p_status)
      and (
        p_grade is null
        or (p_grade = 'A' and score >= 80)
        or (p_grade = 'B' and score >= 60 and score <= 79)
        or (p_grade = 'C' and score >= 40 and score <= 59)
        or (p_grade = 'D' and score < 40)
      )
      and (
        p_q is null or p_q = ''
        or external_id ilike '%' || p_q || '%'
        or city ilike '%' || p_q || '%'
        or street ilike '%' || p_q || '%'
      )
  )
  select jsonb_build_object(
    'byMonth', (
      select coalesce(jsonb_object_agg(ym, cnt), '{}'::jsonb)
      from (
        select to_char(matures_at, 'YYYY-MM') as ym, count(*) as cnt
        from filtered
        group by 1
      ) s
    ),
    'byGrade', (
      select coalesce(jsonb_object_agg(grade, cnt), '{}'::jsonb)
      from (
        select
          -- Grade boundaries (80/60/40) are duplicated in three other places that cannot share
          -- code across JS/TSX/SQL — keep all four in sync when changing these numbers:
          -- scripts/lib/renewal-merge.mjs (`gradeFor`), lib/outreach/renewal-shared.ts
          -- (`gradeScoreRange`), components/renewals/RenewalQueue.tsx (`gradeForScore`).
          case
            when score >= 80 then 'A'
            when score >= 60 then 'B'
            when score >= 40 then 'C'
            else 'D'
          end as grade,
          count(*) as cnt
        from filtered
        group by 1
      ) s
    ),
    'byCity', (
      select coalesce(jsonb_object_agg(coalesce(city, 'לא ידוע'), cnt), '{}'::jsonb)
      from (
        select city, count(*) as cnt
        from filtered
        group by 1
      ) s
    ),
    'bySegment', (
      select coalesce(jsonb_object_agg(segment, cnt), '{}'::jsonb)
      from (
        select segment, count(*) as cnt
        from filtered
        group by 1
      ) s
    )
  );
$$;

revoke all on function public.renewal_leads_aggregates(uuid, text, text, text, text, text) from public;
grant execute on function public.renewal_leads_aggregates(uuid, text, text, text, text, text) to service_role;
