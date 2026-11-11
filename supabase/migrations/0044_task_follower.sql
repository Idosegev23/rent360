-- Tasks: a follow-up owner separate from the assignee (Oct 2026).
-- assignee_user_id = who does the work; follower_user_id = who tracks that it gets done.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS follower_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_org_follower_status ON public.tasks (org_id, follower_user_id, status);

COMMENT ON COLUMN public.tasks.follower_user_id IS 'Who follows up that the task is completed (distinct from assignee_user_id, who does it). NULL = nobody tracks it.';
