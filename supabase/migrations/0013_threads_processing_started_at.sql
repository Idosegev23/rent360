-- The conversation orchestrator (lib/ai/conversation-orchestrator.ts) performs an atomic
-- per-thread claim using threads.processing_started_at. The column was missing in this
-- database, so the claim UPDATE errored and the AI agent never ran for inbound messages
-- (every inbound returned skipped_no_messages). Add it.
--
-- Note: the orchestrator's claim is now also best-effort — if this column isn't visible
-- (e.g. PostgREST schema-cache lag right after this migration) it proceeds without the
-- lock instead of dropping the reply.
ALTER TABLE public.threads ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;
