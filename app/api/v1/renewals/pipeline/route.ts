import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { requireAdminOrg } from '../../../../../lib/outreach/admin-context'
import {
  buildRenewalRow,
  renewalCountsChunked,
  gradeScoreRange,
  loadRenewalTemplates,
  type RenewalLeadJoinRow,
} from '../../../../../lib/outreach/renewal-shared'

const PAGE_SIZE = 50

type Aggregates = {
  byMonth: Record<string, number>
  byGrade: Record<string, number>
  byCity: Record<string, number>
  bySegment: Record<string, number>
}

/**
 * Full renewal-leads browser: server-paginated over all 13k+ rows (not just the due window).
 * `aggregates` reflects the SAME filters as `rows`/`total` (everything except `page`), computed
 * DB-side via the `renewal_leads_aggregates` SQL function (migration 0039) — grouped counts, not
 * 13,463 rows fetched and counted in JS. With no filters it's the full-table breakdown.
 *
 * Query params (all optional): city, segment ('private_once'|'repeat'), grade ('A'|'B'|'C'|'D'),
 *   status, q (free-text over external_id/city/street), page (1-based, pageSize fixed at 50).
 */
export async function GET(req: NextRequest) {
  const ctx = await requireAdminOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { orgId } = ctx
  const sb = supabaseService()

  const url = req.nextUrl
  const city = url.searchParams.get('city')?.trim() || null
  const segmentParam = url.searchParams.get('segment')?.trim() || null
  const segment = segmentParam === 'private_once' || segmentParam === 'repeat' ? segmentParam : null
  const grade = url.searchParams.get('grade')
  const status = url.searchParams.get('status')?.trim() || null
  // PostgREST's `.or()` filter uses `,` and `()` as syntax — strip them from free-text input so
  // a stray comma/paren in the search box can't corrupt the filter string.
  const qRaw = url.searchParams.get('q')?.trim() || null
  const q = qRaw ? qRaw.replace(/[,()]/g, ' ').trim() || null : null
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  let query = sb
    .from('renewal_leads')
    .select(
      `
      id, property_id, external_id, city, street, segment, score, status,
      delisted_at, matures_at, days_on_market, times_listed, price_last, price_change_pct,
      phone_kind, phone_alt,
      properties!inner(contact_name, contact_phone, neighborhood, type, sqm, rooms, street, address)
    `,
      { count: 'exact' },
    )
    .eq('org_id', orgId)
    .order('matures_at', { ascending: true })
    .order('score', { ascending: false })
    .range(from, to)

  if (city) query = query.eq('city', city)
  if (segment) query = query.eq('segment', segment)
  if (status) query = query.eq('status', status)
  if (q) query = query.or(`external_id.ilike.%${q}%,city.ilike.%${q}%,street.ilike.%${q}%`)
  const range = gradeScoreRange(grade)
  if (range) {
    if (range.gte !== undefined) query = query.gte('score', range.gte)
    if (range.lte !== undefined) query = query.lte('score', range.lte)
    if (range.lt !== undefined) query = query.lt('score', range.lt)
  }

  const [{ data, error, count }, { data: aggData, error: aggErr }, { bodyBySegment }] = await Promise.all([
    query,
    sb.rpc('renewal_leads_aggregates', {
      p_org_id: orgId,
      p_city: city,
      p_grade: grade || null,
      p_segment: segment,
      p_status: status,
      p_q: q,
    }),
    loadRenewalTemplates(),
  ])

  if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })
  if (aggErr) return NextResponse.json({ error: { code: 'DB_ERROR', message: aggErr.message } }, { status: 500 })

  const pageRows = (data || []) as unknown as RenewalLeadJoinRow[]
  const phones = pageRows.map(r => r.properties?.contact_phone || '').filter(Boolean)
  const counts = await renewalCountsChunked(orgId, phones)
  const rows = pageRows.map(r => buildRenewalRow(r, bodyBySegment, counts))

  const aggregates: Aggregates = (aggData as Aggregates | null) || {
    byMonth: {},
    byGrade: {},
    byCity: {},
    bySegment: {},
  }

  return NextResponse.json({
    ok: true,
    rows,
    total: count || 0,
    page,
    pageSize: PAGE_SIZE,
    aggregates,
  })
}
