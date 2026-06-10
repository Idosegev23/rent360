-- 0018: Google integration (per-user Calendar + Gmail). Additive + idempotent.

CREATE TABLE IF NOT EXISTS public.google_connections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  google_email  text,
  access_token  text,
  refresh_token text,                              -- AES-256-GCM ciphertext "iv:tag:data"
  scopes        text[],
  token_expiry  timestamptz,
  status        text NOT NULL DEFAULT 'active',    -- 'active' | 'invalid'
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_google_connections_org_user
  ON public.google_connections (org_id, user_id);

DROP TRIGGER IF EXISTS trg_google_connections_updated_at ON public.google_connections;
CREATE TRIGGER trg_google_connections_updated_at BEFORE UPDATE ON public.google_connections
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.google_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS google_connections_self ON public.google_connections;
CREATE POLICY google_connections_self ON public.google_connections
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Note: thread→user assignment uses the pre-existing public.threads.assigned_to column.

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS default_calendar_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
