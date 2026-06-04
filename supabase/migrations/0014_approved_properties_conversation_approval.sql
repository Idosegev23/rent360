-- Conversational brokerage approval (the AI agent records an approval captured in chat).
-- Adds a readable summary + the conversation transcript, and allows the new approval_method.
ALTER TABLE public.approved_properties
  ADD COLUMN IF NOT EXISTS approval_summary text,
  ADD COLUMN IF NOT EXISTS conversation_transcript text;

ALTER TABLE public.approved_properties DROP CONSTRAINT IF EXISTS approved_properties_approval_method_check;
ALTER TABLE public.approved_properties ADD CONSTRAINT approved_properties_approval_method_check
  CHECK (approval_method = ANY (ARRAY['questionnaire'::text, 'manual'::text, 'conversation'::text]));
