-- 0007_thread_coalesce_claim.sql
-- Atomic claim column for the per-thread coalesce window used by the
-- conversation orchestrator. Applied 2026-05-20 via Supabase MCP.

alter table public.threads
  add column if not exists processing_started_at timestamptz;

create index if not exists idx_threads_processing on public.threads(processing_started_at) where processing_started_at is not null;
