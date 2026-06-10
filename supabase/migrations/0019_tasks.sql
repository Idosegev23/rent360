-- 0019: Tasks — assignable to-dos (due date, status, priority, entity link) + WhatsApp reminders.
-- Additive + idempotent. All staff share permissions; assignee marks ownership, not access.

CREATE TABLE IF NOT EXISTS public.tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL,
  title            text NOT NULL,
  notes            text,
  assignee_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'open',     -- open | in_progress | done | cancelled
  priority         text NOT NULL DEFAULT 'normal',   -- low | normal | high | urgent
  due_at           timestamptz,
  entity_type      text,                              -- property | renter | thread | tenancy | meeting | contact
  entity_id        uuid,
  remind_at        timestamptz,
  reminded_at      timestamptz,
  done_at          timestamptz,
  done_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_org_assignee_status ON public.tasks (org_id, assignee_user_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_org_due ON public.tasks (org_id, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_entity ON public.tasks (org_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_tasks_remind ON public.tasks (remind_at)
  WHERE status IN ('open', 'in_progress') AND reminded_at IS NULL;

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON public.tasks;
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_all_tasks ON public.tasks;
CREATE POLICY org_all_tasks ON public.tasks
  FOR ALL USING (org_id = public.jwt_org_id()) WITH CHECK (org_id = public.jwt_org_id());
