-- Agreed brokerage commission captured at recruitment, expressed in MONTHS of rent
-- (the brokerage model = one month's rent incl. VAT, half-month floor). The shekel figure is
-- derived on the fly from the property's price, so we only store the agreed months + an optional note.
-- The signed proof of the agreement is stored via the existing documents vault as a row with
-- kind='commission_proof' (private deal-docs bucket) — no schema change needed for the proof.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS agreed_commission_months numeric,
  ADD COLUMN IF NOT EXISTS agreed_commission_note text;

COMMENT ON COLUMN public.properties.agreed_commission_months IS
  'Commission agreed with the landlord at recruitment, in months of rent (e.g. 1, 0.5). NULL = not agreed yet.';
COMMENT ON COLUMN public.properties.agreed_commission_note IS
  'Free-text note about the agreed commission (terms, who agreed, caveats).';
