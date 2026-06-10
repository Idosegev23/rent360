-- 0020: Meetings — local mirror of Google Calendar events (Google is source of truth).
-- Additive + idempotent. Created via the owner's per-user Google connection (lib/google/calendar.ts).

CREATE TABLE IF NOT EXISTS public.meetings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL,
  owner_user_id        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by           uuid REFERENCES public.users(id) ON DELETE SET NULL,
  title                text NOT NULL,
  location             text,
  notes                text,
  property_id          uuid,
  renter_id            uuid,
  thread_id            uuid,
  google_event_id      text,
  google_calendar_id   text NOT NULL DEFAULT 'primary',
  starts_at            timestamptz NOT NULL,
  ends_at              timestamptz NOT NULL,
  status               text NOT NULL DEFAULT 'confirmed',   -- confirmed | cancelled | tentative
  whatsapp_reminded_at timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meetings_org_owner_start ON public.meetings (org_id, owner_user_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_meetings_remind ON public.meetings (starts_at)
  WHERE status = 'confirmed' AND whatsapp_reminded_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_meetings_google_event ON public.meetings (google_event_id) WHERE google_event_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_meetings_updated_at ON public.meetings;
CREATE TRIGGER trg_meetings_updated_at BEFORE UPDATE ON public.meetings
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_all_meetings ON public.meetings;
CREATE POLICY org_all_meetings ON public.meetings
  FOR ALL USING (org_id = public.jwt_org_id()) WITH CHECK (org_id = public.jwt_org_id());
