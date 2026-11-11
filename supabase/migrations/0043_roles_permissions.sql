-- Role-based permissions (Oct 2026). Adds the 'marketing' role (Ronit, future) and a per-user
-- override column so access can be widened/narrowed without a code change.
-- Idempotent. Existing rows are untouched: every current active staff member is still 'admin'.

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('owner','admin','agent','office','marketing','viewer'));

-- { "grant": ["commissions.view_all"], "deny": ["outreach.send"] } — applied on top of the role's defaults.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.users.permissions IS
  'Per-user capability overrides on top of the role defaults (lib/auth/permissions.ts): { grant: string[], deny: string[] }.';
