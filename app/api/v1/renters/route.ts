import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseService } from '../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../lib/auth'
import { renterSendCounts, RENTER_PER_DAY_CAP } from '../../../../lib/outreach/governance'

/**
 * Admin: list the global renter pool with a per-renter match count
 * (scoped to the caller's org's properties).
 *
 * Renters table has no org_id — the pool is shared across all projects
 * that write to it (rent360renter, this app, future ones). The match
 * count we attach IS org-scoped: how many of the caller's approved
 * properties this renter qualifies for (non-DQ).
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
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
  const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '50'), 200))
  const search = (url.searchParams.get('search') || '').trim()
  const city = (url.searchParams.get('city') || '').trim()
  const offset = (page - 1) * limit
  const sort = url.searchParams.get('sort') || 'created_at'
  const dir = url.searchParams.get('dir') === 'asc' ? true : false

  // Renters base query — global pool (no org filter on the renter row itself)
  const RENTER_COLS = 'id, phone, first_name, last_name, email, created_at, updated_at, submissions_count, budget_min, budget_max, preferred_cities, preferred_rooms, rooms_flexible, move_in_date, household_size, has_children, has_pets, smokers, employment_status, has_payslips, has_security_checks, has_guarantors'
  let q = sb.from('renters').select(RENTER_COLS, { count: 'exact' })

  if (search) {
    q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone.ilike.%${search}%`)
  }
  if (city) {
    q = q.contains('preferred_cities', [city])
  }
  // Vetted = filled the questionnaire (submissions_count>0). Unvetted = imported leads (0).
  const vetted = url.searchParams.get('vetted')
  if (vetted === 'true') q = q.gt('submissions_count', 0)
  else if (vetted === 'false') q = q.eq('submissions_count', 0)

  // Renters who already rented through us (have an ACTIVE tenancy) are "placed" — by default they
  // drop out of the active seekers list. ?placed=1 → only placed; ?placed=include → everyone.
  const placedParam = url.searchParams.get('placed') || ''
  const { data: activeTen } = await sb.from('tenancies').select('renter_id').eq('org_id', orgId).eq('status', 'active')
  const placedIds = Array.from(new Set((activeTen || []).map((t: any) => t.renter_id).filter(Boolean))) as string[]
  const placedSet = new Set(placedIds)
  if (placedParam === '1') {
    if (placedIds.length === 0) {
      return NextResponse.json({ renters: [], pagination: { page, limit, total: 0, totalPages: 0, hasNext: false, hasPrev: false } })
    }
    q = q.in('id', placedIds)
  } else if (placedParam !== 'include' && placedIds.length > 0) {
    q = q.not('id', 'in', `(${placedIds.join(',')})`)
  }

  // Allow sort by created_at / updated_at / submissions_count
  const allowedSort = new Set(['created_at', 'updated_at', 'submissions_count', 'budget_max'])
  const sortCol = allowedSort.has(sort) ? sort : 'created_at'
  q = q.order(sortCol, { ascending: dir }).range(offset, offset + limit - 1)

  const { data: renters, error, count } = await q
  if (error) return NextResponse.json({ error: { code: 'QUERY_FAILED', message: error.message } }, { status: 500 })

  // Attach per-renter match count (non-DQ) for the caller's org
  const renterIds = (renters || []).map(r => r.id)
  const matchCounts: Record<string, { total: number; topScore: number | null }> = {}
  if (renterIds.length > 0) {
    const { data: matches } = await sb
      .from('matches')
      .select('renter_id, score, is_disqualified')
      .eq('org_id', orgId)
      .in('renter_id', renterIds)
      .eq('is_disqualified', false)
    for (const m of matches || []) {
      const rid = (m as any).renter_id as string
      if (!matchCounts[rid]) matchCounts[rid] = { total: 0, topScore: null }
      matchCounts[rid].total += 1
      const s = Number((m as any).score) || 0
      if (matchCounts[rid].topScore === null || s > matchCounts[rid].topScore!) {
        matchCounts[rid].topScore = s
      }
    }
  }

  // Per-renter unified send counts (auto + manual), sourced from matches.renter_notified_at.
  const sendCounts = renterIds.length > 0 ? await renterSendCounts(orgId, renterIds) : {}

  const enriched = (renters || []).map(r => ({
    ...r,
    matches: matchCounts[r.id] || { total: 0, topScore: null },
    send_counts: sendCounts[r.id] || { today: 0, total: 0 },
    placed: placedSet.has(r.id),
  }))

  const totalPages = Math.ceil((count || 0) / limit)
  return NextResponse.json({
    renters: enriched,
    // The real per-day cap (env-overridable) so the UI badge stays truthful if it changes.
    per_day_cap: RENTER_PER_DAY_CAP,
    pagination: {
      page,
      limit,
      total: count || 0,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  })
}
