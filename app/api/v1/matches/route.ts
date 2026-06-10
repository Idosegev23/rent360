import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseService } from '../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../lib/auth'
import { computeMatchesInBackground } from '../../../../lib/matching/orchestrator'

/**
 * GET — list matches for a property OR a renter.
 *  - ?property_id=X → renters scored against X (with renter details)
 *  - ?renter_id=Y   → properties matching Y (with property details)
 *
 * POST — admin: recompute matches.
 *  body { property_id?: string; renter_id?: string }
 */

export async function GET(req: NextRequest) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })
  const orgId = user.org_id

  const url = new URL(req.url)
  const propertyId = url.searchParams.get('property_id')
  const renterId = url.searchParams.get('renter_id')
  const includeDq = url.searchParams.get('include_dq') !== 'false' // default true (user said "להציג הכל")
  const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '50'), 200))

  if (!propertyId && !renterId) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'property_id or renter_id required' } }, { status: 400 })
  }

  let q = sb
    .from('matches')
    .select('id, renter_id, property_id, score, is_disqualified, disqualifying_reasons, breakdown, reasons, status, updated_at, renter_notified_at')
    .eq('org_id', orgId)
  if (propertyId) q = q.eq('property_id', propertyId)
  if (renterId) q = q.eq('renter_id', renterId)
  if (!includeDq) q = q.eq('is_disqualified', false)
  q = q
    .order('is_disqualified', { ascending: true })
    .order('score', { ascending: false, nullsFirst: false })
    .limit(limit)

  const { data: matches, error } = await q
  if (error) return NextResponse.json({ error: { code: 'QUERY_FAILED', message: error.message } }, { status: 500 })

  // Hydrate either renters (if filtered by property) or properties (if filtered by renter)
  let enriched: any[] = matches || []
  if (propertyId) {
    const renterIds = Array.from(new Set((matches || []).map(m => m.renter_id))).filter(Boolean) as string[]
    if (renterIds.length > 0) {
      const { data: renters } = await sb
        .from('renters')
        .select('id, first_name, last_name, phone, budget_min, budget_max, preferred_rooms, preferred_cities, move_in_date, has_pets, smokers, household_size, has_payslips, has_security_checks, has_guarantors')
        .in('id', renterIds)
      const map = Object.fromEntries((renters || []).map(r => [r.id, r]))
      enriched = (matches || []).map(m => ({ ...m, renter: map[m.renter_id] || null }))
    }
  } else if (renterId) {
    const propertyIds = Array.from(new Set((matches || []).map(m => m.property_id))).filter(Boolean) as string[]
    if (propertyIds.length > 0) {
      const { data: props } = await sb
        .from('properties')
        .select('id, title, city, neighborhood, street, address, price, rooms, sqm, floor, images, evacuation_date')
        .in('id', propertyIds)
      const map = Object.fromEntries((props || []).map(p => [p.id, p]))
      enriched = (matches || []).map(m => ({ ...m, property: map[m.property_id] || null }))
    }
  }

  return NextResponse.json({ matches: enriched, count: enriched.length })
}

export async function POST(req: NextRequest) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })

  let body: any = {}
  try { body = await req.json() } catch {}
  const propertyId = typeof body.property_id === 'string' ? body.property_id : undefined
  const renterId = typeof body.renter_id === 'string' ? body.renter_id : undefined
  if (!propertyId && !renterId) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'property_id or renter_id required' } }, { status: 400 })
  }

  computeMatchesInBackground({ propertyId, renterId })
  return NextResponse.json({ ok: true, queued: true })
}
