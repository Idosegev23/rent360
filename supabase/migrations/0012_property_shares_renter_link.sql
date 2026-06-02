-- Match-aware share tokens.
--
-- A renter who gets a "we found you an apartment" WhatsApp alert receives a /share
-- link that should resolve to the property PLUS their personalized match breakdown
-- (score, what matches, what's missing). To do that the share row needs to remember
-- which renter (and which match) it was minted for.
--
-- Existing landlord/general share tokens have renter_id IS NULL and keep their
-- one-token-per-property behavior. The blanket UNIQUE(org_id, property_id) is replaced
-- by two partial unique indexes so a property can have one general token plus one token
-- per renter.

alter table public.property_shares
  add column if not exists renter_id uuid references public.renters(id) on delete set null,
  add column if not exists match_id  uuid references public.matches(id)  on delete set null;

alter table public.property_shares drop constraint if exists property_shares_org_id_property_id_key;

create unique index if not exists property_shares_org_property_general_key
  on public.property_shares (org_id, property_id)
  where renter_id is null;

create unique index if not exists property_shares_org_property_renter_key
  on public.property_shares (org_id, property_id, renter_id)
  where renter_id is not null;
