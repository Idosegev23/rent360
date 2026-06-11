-- Recurring tasks (appear every day/weekday/week — like a repeating calendar to-do).
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS recurrence text CHECK (recurrence IN ('daily','weekdays','weekly'));
