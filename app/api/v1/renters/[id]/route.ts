import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseService } from '../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../lib/auth'

/** Admin: full renter profile + their org-scoped matches (with property details). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })
  const orgId = user.org_id

  const { data: renter, error } = await sb
    .from('renters')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: { code: 'QUERY_FAILED', message: error.message } }, { status: 500 })
  if (!renter) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })

  // Matches scoped to this org. Sorted: non-DQ by score desc, then DQ.
  const { data: matches } = await sb
    .from('matches')
    .select('id, property_id, score, is_disqualified, disqualifying_reasons, breakdown, reasons, status, updated_at')
    .eq('org_id', orgId)
    .eq('renter_id', params.id)
    .order('is_disqualified', { ascending: true })
    .order('score', { ascending: false, nullsFirst: false })
    .limit(50)

  // Hydrate property data for the matches
  const propertyIds = (matches || []).map(m => m.property_id)
  let propertiesById: Record<string, any> = {}
  if (propertyIds.length > 0) {
    const { data: props } = await sb
      .from('properties')
      .select('id, title, city, neighborhood, street, address, price, rooms, sqm, floor, images')
      .in('id', propertyIds)
    propertiesById = Object.fromEntries((props || []).map(p => [p.id, p]))
  }

  const enrichedMatches = (matches || []).map(m => ({
    ...m,
    property: propertiesById[m.property_id] || null,
  }))

  // Most recent submission snapshot (for "what they answered")
  const { data: lastSubmission } = await sb
    .from('renter_submissions')
    .select('id, submitted_at, snapshot, invite_token')
    .eq('renter_id', params.id)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    renter,
    matches: enrichedMatches,
    last_submission: lastSubmission,
  })
}
