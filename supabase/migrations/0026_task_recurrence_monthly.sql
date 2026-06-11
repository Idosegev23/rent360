-- Add monthly recurrence option.
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_recurrence_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_recurrence_check CHECK (recurrence IN ('daily','weekdays','weekly','monthly'));
