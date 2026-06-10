import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseService } from '../../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../../lib/auth'
import { dispatchRenterMatchAlert } from '../../../../../../lib/outreach/renter-alert'

/**
 * One-click: send a renter their TOP-N best matches (default 5) in WhatsApp — but only matches
 * that clear the score threshold (default 90%), aren't disqualified, weren't already sent to this
 * renter, AND aren't already offered to another renter (so the same apartment isn't blasted to
 * many people). Each send goes through dispatchRenterMatchAlert (opt-out + template + image gates).
 */
export const maxDuration = 60

const MIN_SCORE = Number(process.env.RENTER_TOP_MATCH_MIN_SCORE || '90')
const TOP_N = Number(process.env.RENTER_TOP_MATCH_COUNT || '5')

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })
  const orgId = user.org_id
  const renterId = params.id

  // Candidates: this renter's qualifying, not-yet-sent matches, best first.
  const { data: cand } = await sb
    .from('matches')
    .select('id, property_id, score, renter_notified_at')
    .eq('org_id', orgId)
    .eq('renter_id', renterId)
    .eq('is_disqualified', false)
    .gte('score', MIN_SCORE)
    .is('renter_notified_at', null)
    .order('score', { ascending: false, nullsFirst: false })
    .limit(50)
  const candidates = (cand || []).filter(c => c.property_id)
  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, skippedTaken: 0, minScore: MIN_SCORE, reason: 'no_candidates', details: [] })
  }

  // Exclude properties already offered to ANOTHER renter (don't send the same apartment to many).
  const propIds = Array.from(new Set(candidates.map(c => c.property_id as string)))
  const { data: othersSent } = await sb
    .from('matches')
    .select('property_id')
    .eq('org_id', orgId)
    .in('property_id', propIds)
    .not('renter_notified_at', 'is', null)
    .neq('renter_id', renterId)
  const takenProps = new Set((othersSent || []).map(r => r.property_id as string))

  const eligible = candidates.filter(c => !takenProps.has(c.property_id as string)).slice(0, TOP_N)
  const skippedTaken = candidates.filter(c => takenProps.has(c.property_id as string)).length

  const details: Array<{ propertyId: string; status: 'sent' | 'skipped'; reason?: string }> = []
  let sent = 0, skipped = 0
  for (const c of eligible) {
    const r = await dispatchRenterMatchAlert({ orgId, renterId, propertyId: c.property_id as string, matchId: c.id as string })
    if (r.ok) { sent++; details.push({ propertyId: c.property_id as string, status: 'sent' }) }
    else { skipped++; details.push({ propertyId: c.property_id as string, status: 'skipped', reason: r.code }) }
  }

  return NextResponse.json({ ok: true, sent, skipped, skippedTaken, minScore: MIN_SCORE, count: eligible.length, details })
}
