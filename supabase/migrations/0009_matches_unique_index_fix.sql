-- 0009_matches_unique_index_fix.sql
-- The 0008 partial unique index (WHERE renter_id IS NOT NULL) was unusable by
-- ON CONFLICT in upserts — Postgres requires either a non-partial unique index
-- or an exact predicate match in INDEX_PREDICATE form. We use the upsert via
-- the JS client which doesn't expose the predicate option, so we drop the
-- WHERE clause and rely on NULL-distinct semantics.
drop index if exists public.idx_matches_unique_renter_property;
create unique index idx_matches_unique_renter_property
  on public.matches(org_id, renter_id, property_id);
