import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseService } from '../../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../../lib/auth'
import { scoreMatch, type RenterRow, type PropertyRow } from '../../../../../../lib/matching/renter-property'

/**
 * "Recruitment matches" for a renter: UNAPPROVED properties (not in approved_properties, active, has
 * a landlord phone, not opted-out, and NOT yet recruited) that score ≥90 against this renter — so the
 * agent can proactively recruit those owners on the strength of real demand. Scored on the fly (reuses
 * the matching engine); the heavy embedding column is skipped (text-similarity is only a 7% dimension).
 */
const MIN_SCORE = 90
const MAX_RESULTS = 30
const CANDIDATE_CAP = 1500 // bound the on-the-fly scoring work

// Same fields scoreMatch needs, minus `embedding`, plus display fields.
const RENTER_COLS = 'id, preferred_cities, preferred_neighborhoods, preferred_rooms, rooms_flexible, min_sqm, floor_min, floor_max, top_floor_preference, condition_preference, budget_min, budget_max, budget_flexibility, vaad_bayit_max, arnona_max, move_in_date, move_in_flexible, has_pets, smokers, household_size, has_children, children_count, preferences, match_weights'
const PROP_COLS = 'id, org_id, city, neighborhood, street, address, price, rooms, sqm, floor, amenities, evacuation_date, available_from, pets_allowed, smokers_allowed, is_active, title, images, contact_name, contact_phone, initial_message_sent'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })
  const orgId = user.org_id

  const { data: renter } = await sb.from('renters').select(RENTER_COLS).eq('id', params.id).maybeSingle()
  if (!renter) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })

  // Already-approved property ids (exclude — those are recruited + on the market).
  const { data: approvedRows } = await sb.from('approved_properties').select('property_id').eq('org_id', orgId)
  const approvedIds = (approvedRows || []).map(r => r.property_id).filter(Boolean) as string[]

  // Candidate unapproved properties, not yet recruited.
  let q = sb
    .from('properties')
    .select(PROP_COLS)
    .eq('org_id', orgId)
    .eq('is_active', true)
    .not('contact_phone', 'is', null)
    .not('outreach_blocked', 'is', true)
    .not('initial_message_sent', 'is', true)
    .limit(CANDIDATE_CAP)

  // Budget pre-filter (safe narrower): price within budget + flexibility, or price unknown.
  const budgetMax = (renter as any).budget_max as number | null
  const flex = ((renter as any).budget_flexibility as number | null) || 0
  if (budgetMax && budgetMax > 0) {
    const cap = Math.round(budgetMax * (1 + flex / 100))
    q = q.or(`price.is.null,price.lte.${cap}`)
  }
  if (approvedIds.length) q = q.not('id', 'in', `(${approvedIds.join(',')})`)

  const { data: candidates, error } = await q
  if (error) return NextResponse.json({ error: { code: 'QUERY_FAILED', message: error.message } }, { status: 500 })

  const scored = (candidates || [])
    .map(p => {
      const result = scoreMatch(renter as unknown as RenterRow, p as unknown as PropertyRow)
      return { p, result }
    })
    .filter(({ result }) => !result.isDisqualified && result.score >= MIN_SCORE)
    .sort((a, b) => b.result.score - a.result.score)
    .slice(0, MAX_RESULTS)
    .map(({ p, result }) => {
      const prop = p as any
      return {
        property_id: prop.id,
        percentage: Math.round(result.score),
        reasons: (result.reasons || []).slice(0, 4),
        title: prop.title,
        city: prop.city,
        neighborhood: prop.neighborhood,
        price: prop.price,
        rooms: prop.rooms,
        sqm: prop.sqm,
        contact_name: prop.contact_name,
        image: Array.isArray(prop.images) ? prop.images.find((u: unknown) => typeof u === 'string') || null : null,
      }
    })

  return NextResponse.json({ matches: scored, min_score: MIN_SCORE, scanned: (candidates || []).length })
}
