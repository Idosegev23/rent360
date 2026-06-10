-- Team foundation: make `users` a real staff directory so שי/זיו/דריה/עידו are first-class users
-- (Google login, assignable, reachable by phone for WhatsApp). Additive + idempotent.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_active       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS receives_alerts boolean NOT NULL DEFAULT true,  -- WhatsApp nudge opt-in
  ADD COLUMN IF NOT EXISTS title           text,
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_users_org_active ON public.users (org_id, is_active);

DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
