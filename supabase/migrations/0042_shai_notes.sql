-- Shai's notes (Oct 2026): property running costs + "price includes", renter ranges + alternative security.
-- Additive and idempotent; nothing existing is renamed or dropped.

-- Property: monthly arnona / building committee, and what the asking rent already covers.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS arnona_monthly      integer,
  ADD COLUMN IF NOT EXISTS vaad_bayit_monthly  integer,
  ADD COLUMN IF NOT EXISTS price_includes      jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.properties.arnona_monthly IS 'Monthly arnona in ₪, as quoted by the landlord. NULL = unknown.';
COMMENT ON COLUMN public.properties.vaad_bayit_monthly IS 'Monthly building committee fee in ₪. NULL = unknown.';
COMMENT ON COLUMN public.properties.price_includes IS 'Array of keys the asking rent already includes: arnona | vaad_bayit | water | electricity | gas | internet.';

-- Renter: ranges instead of single values. preferred_rooms / move_in_date stay as the
-- midpoint / range start so every existing reader keeps working.
ALTER TABLE public.renters
  ADD COLUMN IF NOT EXISTS preferred_rooms_min  numeric,
  ADD COLUMN IF NOT EXISTS preferred_rooms_max  numeric,
  ADD COLUMN IF NOT EXISTS move_in_date_to      date,
  ADD COLUMN IF NOT EXISTS security_alternatives jsonb;

COMMENT ON COLUMN public.renters.security_alternatives IS 'When the renter has no guarantors: array of what they can bring instead — bank_guarantee | bank_check | cash_deposit.';
