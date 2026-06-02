import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { requireAdminOrg } from '../../../../../lib/outreach/admin-context'
import { dispatchRenterMatchAlert } from '../../../../../lib/outreach/renter-alert'
import {
  DAILY_CAP,
  RENTER_PER_DAY_CAP,
  MANUAL_BATCH_MAX,
  templatesSentToday,
  sleepJitter,
} from '../../../../../lib/outreach/governance'

/**
 * Send the renter match alert to a reviewed set of matches.
 *
 * BATCH path → enforces the shared daily cap, a per-renter/day cap (so a renter never
 * gets flooded), a per-click ceiling, and jitter spacing. The dispatcher still enforces
 * dedup (renter_notified_at), suppression, and template approval per row.
 *
 * Body: `{ matchIds: string[] }`.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireAdminOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { orgId } = ctx
  const sb = supabaseService()

  let body: { matchIds?: unknown } = {}
  try {
    body = await req.json()
  } catch {/* empty body */}

  const matchIds = Array.isArray(body.matchIds)
    ? body.matchIds.filter((x): x is string => typeof x === 'string')
    : []
  if (matchIds.length === 0) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'matchIds required' } }, { status: 400 })
  }

  // Resolve the matches (org-scoped) to renter/property + ordering by score.
  const { data: matches, error } = await sb
    .from('matches')
    .select('id, renter_id, property_id, score')
    .eq('org_id', orgId)
    .in('id', matchIds)
    .order('score', { ascending: false })
  if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })
  if (!matches || matches.length === 0) {
    return NextResponse.json({ error: { code: 'MATCH_NOT_FOUND' } }, { status: 404 })
  }

  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)
  const renterIds = Array.from(new Set(matches.map(m => m.renter_id).filter(Boolean)))

  // How many recommendations each of these renters already got today (per-renter/day cap).
  const notifiedTodayCount = new Map<string, number>()
  if (renterIds.length) {
    const { data: todayRows } = await sb
      .from('matches')
      .select('renter_id')
      .eq('org_id', orgId)
      .in('renter_id', renterIds)
      .gte('renter_notified_at', dayStart.toISOString())
    for (const r of todayRows || []) {
      notifiedTodayCount.set(r.renter_id, (notifiedTodayCount.get(r.renter_id) || 0) + 1)
    }
  }

  const sentToday = await templatesSentToday(orgId)
  const remaining = DAILY_CAP - sentToday
  if (remaining <= 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, reason: 'daily_cap_hit', sentTodayBefore: sentToday, dailyCap: DAILY_CAP, results: [] })
  }
  const limit = Math.min(matches.length, remaining, MANUAL_BATCH_MAX)

  const results: Array<{ matchId: string; status: 'sent' | 'skipped'; reason?: string }> = []
  let sent = 0
  let skipped = 0
  for (const m of matches) {
    if (sent >= limit) break
    const already = notifiedTodayCount.get(m.renter_id) || 0
    if (already >= RENTER_PER_DAY_CAP) {
      skipped++
      results.push({ matchId: m.id, status: 'skipped', reason: 'renter_daily_cap: כבר נשלחה לו המלצה היום' })
      continue
    }
    const r = await dispatchRenterMatchAlert({ orgId, renterId: m.renter_id, propertyId: m.property_id, matchId: m.id })
    if (r.ok) {
      sent++
      notifiedTodayCount.set(m.renter_id, already + 1)
      results.push({ matchId: m.id, status: 'sent' })
    } else {
      skipped++
      results.push({ matchId: m.id, status: 'skipped', reason: `${r.code}: ${r.message}` })
    }
    if (sent < limit) await sleepJitter()
  }

  return NextResponse.json({
    ok: true,
    sent,
    skipped,
    sentTodayBefore: sentToday,
    dailyCap: DAILY_CAP,
    capReached: sent >= remaining,
    results,
  })
}
