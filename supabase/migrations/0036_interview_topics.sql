-- Editable renter-interview topics (the "מה-לאסוף" collection list). Only the topic list is
-- externalized; the rest of the intake prompt (personality, rules, closing) stays in code.
-- Not seeded here: DEFAULT_TOPICS in lib/ai/renter-interview/topics.ts is the canonical seed AND
-- the runtime fallback, so the bot works with zero rows. The first admin save writes rows that
-- then override the code defaults. Additive + idempotent.
CREATE TABLE IF NOT EXISTS public.interview_topics (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL,
  key        text NOT NULL,
  title      text NOT NULL,
  body_text  text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  enabled    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_interview_topics_org_key ON public.interview_topics (org_id, key);
CREATE INDEX IF NOT EXISTS idx_interview_topics_org_order ON public.interview_topics (org_id, sort_order);

ALTER TABLE public.interview_topics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_all_interview_topics ON public.interview_topics;
CREATE POLICY org_all_interview_topics ON public.interview_topics
  FOR ALL USING (org_id = public.jwt_org_id()) WITH CHECK (org_id = public.jwt_org_id());
