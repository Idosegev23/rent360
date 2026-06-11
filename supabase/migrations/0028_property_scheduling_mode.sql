-- How viewings are coordinated for this property: 'self_access' (we have a key / full access — no
-- owner needed) vs 'requires_owner' (owner must approve each viewing). Set at approval time.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS scheduling_mode text CHECK (scheduling_mode IN ('self_access','requires_owner'));
