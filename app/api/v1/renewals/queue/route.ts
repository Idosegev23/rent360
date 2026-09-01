import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { requireAdminOrg } from '../../../../../lib/outreach/admin-context'
import { israelToday } from '../../../../../lib/time/israel'
import { DAILY_CAP, templatesSentToday } from '../../../../../lib/outreach/governance'
import {
  buildRenewalRow,
  renewalCountsChunked,
  gradeScoreRange,
  normalizeGrade,
  loadRenewalTemplates,
  type RenewalLeadJoinRow,
} from '../../../../../lib/outreach/renewal-shared'

/**
 * Renewal-outreach queue: `renewal_leads` whose maturity date is due for review right now.
 *
 * R12 (controller ruling) — the due window looks FORWARD as well as back:
 * `matures_at BETWEEN today-45 AND today+30`. A tenancy's renewal decision is made shortly
 * *before* the year-mark anniversary (the tenancy began when the previous listing came down),
 * so a backward-only window always arrives late — it would show nothing until the anniversary
 * has already passed. In this dataset the earliest `matures_at` is 12 days out from today, so a
 * backward-only window returns zero rows.
 *
 * Query params (all optional): city, segment ('private_once'|'repeat'), grade ('A'|'B'|'C'|'D'),
 *   limit, offset.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireAdminOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { orgId } = ctx
  const sb = supabaseService()

  const url = req.nextUrl
  const city = url.searchParams.get('city')?.trim() || null
  const segment = url.searchParams.get('segment')?.trim() || null
  const grade = normalizeGrade(url.searchParams.get('grade'))
  // The due window today is ~256 rows — default high enough that the common case (no
  // pagination) returns the whole queue in one call; limit/offset still work as the window grows.
  const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '300', 10) || 300, 2000))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0)

  let q = sb
    .from('renewal_leads')
    .select(`
      id, property_id, external_id, city, street, segment, score, status,
      delisted_at, matures_at, days_on_market, times_listed, price_last, price_change_pct,
      phone_kind, phone_alt,
      properties!inner(contact_name, contact_phone, neighborhood, type, sqm, rooms, street, address)
    `)
    .eq('org_id', orgId)
    .eq('status', 'pending')
    .gte('matures_at', isoDaysAgo(45))
    .lte('matures_at', isoDaysAhead(30))
    .order('score', { ascending: false })
    .range(offset, offset + limit) // fetch one extra row to detect hasMore without a second count query

  if (city) q = q.eq('city', city)
  if (segment === 'private_once' || segment === 'repeat') q = q.eq('segment', segment)
  const range = gradeScoreRange(grade)
  if (range) {
    if (range.gte !== undefined) q = q.gte('score', range.gte)
    if (range.lte !== undefined) q = q.lte('score', range.lte)
    if (range.lt !== undefined) q = q.lt('score', range.lt)
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })

  const fetched = (data || []) as unknown as RenewalLeadJoinRow[]
  const hasMore = fetched.length > limit
  const pageRows = hasMore ? fetched.slice(0, limit) : fetched

  const [sentToday, { bodyBySegment, templates }] = await Promise.all([
    templatesSentToday(orgId),
    loadRenewalTemplates(),
  ])

  const phones = pageRows.map(r => r.properties?.contact_phone || '').filter(Boolean)
  const counts = await renewalCountsChunked(orgId, phones)

  const rows = pageRows.map(r => buildRenewalRow(r, bodyBySegment, counts))

  return NextResponse.json({
    ok: true,
    rows,
    counters: {
      sentToday,
      dailyCap: DAILY_CAP,
      remaining: Math.max(0, DAILY_CAP - sentToday),
    },
    templates,
    hasMore,
  })
}

// --- Date-window helpers (R12) ---------------------------------------------
// Anchored to Israel-local "today" (`israelToday()`, already used across the codebase for
// day-boundary logic) rather than the server's UTC day, so the window doesn't drift by a day
// around midnight UTC (Israel is UTC+2/+3, ahead of UTC).

function todayIso(): string {
  return israelToday()
}

function addDaysIso(base: string, days: number): string {
  const [y, m, d] = base.split('-').map(Number)
  const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

function isoDaysAgo(n: number): string {
  return addDaysIso(todayIso(), -n)
}

function isoDaysAhead(n: number): string {
  return addDaysIso(todayIso(), n)
}
