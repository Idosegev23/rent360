-- 0031_property_owner_viewing_availability.sql
-- Phase 3 (viewing scheduler) groundwork: free-text owner viewing windows, captured conversationally
-- by the landlord bot when the owner mentions when it's convenient to show the apartment. A human
-- (or the future smart scheduler) reads it to coordinate viewings. Free text by design — owners
-- describe availability in prose ("ימים א'-ה' אחר הצהריים, שישי בבוקר").
alter table public.properties add column if not exists owner_viewing_availability text;
comment on column public.properties.owner_viewing_availability is
  'Free-text owner viewing windows (Phase 3 scheduler groundwork), captured by the landlord bot.';
