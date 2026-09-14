import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { requireAdminOrg } from '../../../../../lib/outreach/admin-context'
import { DAILY_CAP, templatesSentToday } from '../../../../../lib/outreach/governance'
import {
  buildRenewalRow,
  renewalCountsChunked,
  gradeScoreRange,
  normalizeGrade,
  loadRenewalTemplates,
  renewalDueWindow,
  type RenewalLeadJoinRow,
} from '../../../../../lib/outreach/renewal-shared'

/**
 * Renewal-outreach queue: `renewal_leads` whose maturity date is due for review right now.
 *
 * The due window (`renewalDueWindow()`, lib/outreach/renewal-shared.ts) looks FORWARD as well as
 * back — `matures_at BETWEEN today-45 AND today+60`. A tenancy's renewal decision is made shortly
 * *before* the year-mark anniversary, so a backward-only window always arrives late. The autosend
 * cron uses the same helper, so this queue is exactly what it draws from.
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
  // Default high enough that the common case (no pagination) returns the whole queue in one call;
  // limit/offset still work as the window grows.
  const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '300', 10) || 300, 2000))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0)
  const { from, to } = renewalDueWindow()

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
    .gte('matures_at', from)
    .lte('matures_at', to)
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

  // Accurate count of the whole due window (same filters, ignoring limit/offset), via a
  // `count: 'exact', head: true` query — no rows fetched, just the count — so the UI can show
  // "X of TOTAL" and the sidebar badge doesn't freeze at `limit` once the window outgrows it.
  let qCount = sb
    .from('renewal_leads')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'pending')
    .gte('matures_at', from)
    .lte('matures_at', to)
  if (city) qCount = qCount.eq('city', city)
  if (segment === 'private_once' || segment === 'repeat') qCount = qCount.eq('segment', segment)
  if (range) {
    if (range.gte !== undefined) qCount = qCount.gte('score', range.gte)
    if (range.lte !== undefined) qCount = qCount.lte('score', range.lte)
    if (range.lt !== undefined) qCount = qCount.lt('score', range.lt)
  }

  const [{ data, error }, { count: total, error: countError }] = await Promise.all([q, qCount])
  if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })
  if (countError) return NextResponse.json({ error: { code: 'DB_ERROR', message: countError.message } }, { status: 500 })

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
    total: total ?? 0,
  })
}
