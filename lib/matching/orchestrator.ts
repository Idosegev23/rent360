/**
 * Recompute renter↔property matches and persist to `public.matches`.
 *
 * Renters are a global pool (no org_id) — they may come from krayot-rental or
 * other sources. Properties are per-org. A match row is per (org, renter,
 * property) so each org sees only matches against its own properties.
 *
 * Two entry points:
 *   - `computeMatchesForProperty(propertyId)` — every renter scored vs one
 *     property. Called when a property is approved or its data changes.
 *   - `computeMatchesForRenter(renterId)` — one renter scored vs every
 *     approved property in every org. Called when a renter is created/updated.
 *
 * Both upsert into `matches` (one row per pair). Pre-existing rows are
 * overwritten via the unique `(org_id, renter_id, property_id)` index.
 */

import { supabaseService } from '../supabase'
import {
  scoreMatch,
  type RenterRow,
  type PropertyRow,
  type MatchResult,
} from './renter-property'

const RENTER_COLUMNS = `
  id, preferred_cities, preferred_rooms, rooms_flexible, min_sqm,
  floor_min, floor_max, top_floor_preference, condition_preference,
  budget_min, budget_max, budget_flexibility, vaad_bayit_max, arnona_max,
  move_in_date, move_in_flexible, has_pets, smokers, household_size,
  has_children, children_count, match_weights
` as const

const PROPERTY_COLUMNS = `
  id, org_id, city, neighborhood, street, address, price, rooms, sqm, floor,
  amenities, evacuation_date, available_from, pets_allowed, smokers_allowed, is_active
` as const

type PropertyRowWithOrg = PropertyRow & { org_id: string }

/** Compute (or recompute) every renter's match against one property. */
export async function computeMatchesForProperty(propertyId: string): Promise<{ inserted: number; total: number }> {
  const sb = supabaseService()
  const { data: property, error: propErr } = await sb
    .from('properties')
    .select(PROPERTY_COLUMNS)
    .eq('id', propertyId)
    .maybeSingle()
  if (propErr || !property) {
    if (propErr) console.error('[matching] property fetch:', propErr.message)
    return { inserted: 0, total: 0 }
  }
  const prop = property as unknown as PropertyRowWithOrg

  const { data: renters, error: renterErr } = await sb
    .from('renters')
    .select(RENTER_COLUMNS)
  if (renterErr) {
    console.error('[matching] renters fetch:', renterErr.message)
    return { inserted: 0, total: 0 }
  }

  const rows = (renters || []).map(r => {
    const result = scoreMatch(r as unknown as RenterRow, prop)
    return buildMatchRow(prop.org_id, (r as any).id, prop.id, result)
  })

  if (rows.length === 0) return { inserted: 0, total: 0 }

  const { error: upsertErr } = await sb.from('matches').upsert(rows as any, {
    onConflict: 'org_id,renter_id,property_id',
  })
  if (upsertErr) {
    console.error('[matching] upsert:', upsertErr.message)
    return { inserted: 0, total: rows.length }
  }
  return { inserted: rows.length, total: rows.length }
}

/** Compute (or recompute) one renter's match against every approved property. */
export async function computeMatchesForRenter(renterId: string): Promise<{ inserted: number; total: number }> {
  const sb = supabaseService()
  const { data: renter, error: renterErr } = await sb
    .from('renters')
    .select(RENTER_COLUMNS)
    .eq('id', renterId)
    .maybeSingle()
  if (renterErr || !renter) {
    if (renterErr) console.error('[matching] renter fetch:', renterErr.message)
    return { inserted: 0, total: 0 }
  }

  // Approved properties across all orgs
  const { data: approvedRows } = await sb
    .from('approved_properties')
    .select('property_id, org_id')
  const approvedPropertyIds = Array.from(new Set((approvedRows || []).map(r => r.property_id))).filter(Boolean) as string[]
  if (approvedPropertyIds.length === 0) return { inserted: 0, total: 0 }

  const { data: properties, error: propErr } = await sb
    .from('properties')
    .select(PROPERTY_COLUMNS)
    .in('id', approvedPropertyIds)
  if (propErr) {
    console.error('[matching] properties fetch:', propErr.message)
    return { inserted: 0, total: 0 }
  }

  const rows = (properties || []).map(p => {
    const prop = p as unknown as PropertyRowWithOrg
    const result = scoreMatch(renter as unknown as RenterRow, prop)
    return buildMatchRow(prop.org_id, renterId, prop.id, result)
  })

  if (rows.length === 0) return { inserted: 0, total: 0 }

  const { error: upsertErr } = await sb.from('matches').upsert(rows as any, {
    onConflict: 'org_id,renter_id,property_id',
  })
  if (upsertErr) {
    console.error('[matching] upsert:', upsertErr.message)
    return { inserted: 0, total: rows.length }
  }
  return { inserted: rows.length, total: rows.length }
}

function buildMatchRow(orgId: string, renterId: string, propertyId: string, result: MatchResult) {
  return {
    org_id: orgId,
    renter_id: renterId,
    property_id: propertyId,
    score: result.score,
    is_disqualified: result.isDisqualified,
    disqualifying_reasons: result.disqualifyingReasons,
    breakdown: result.breakdown,
    reasons: result.reasons,
    status: result.isDisqualified ? 'disqualified' : 'pending',
    updated_at: new Date().toISOString(),
  }
}

/** Fire-and-forget wrapper for the hot paths (approve route, etc.) */
export function computeMatchesInBackground(opts: { propertyId?: string; renterId?: string }): void {
  const p = opts.propertyId ? computeMatchesForProperty(opts.propertyId) : Promise.resolve(null)
  const r = opts.renterId ? computeMatchesForRenter(opts.renterId) : Promise.resolve(null)
  Promise.all([p, r]).catch(err => {
    console.error('[matching:bg]', err instanceof Error ? err.message : String(err))
  })
}
