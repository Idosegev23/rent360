import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { dispatchRenterMatchAlert } from '../../../../../lib/outreach/renter-alert'
import { RENTER_MIN_SCORE, RENTER_PER_DAY_CAP, DAILY_CAP, templatesSentToday } from '../../../../../lib/outreach/governance'

const BATCH_SIZE_DEFAULT = 20

/**
 * Cron-triggered batch of renter match alerts (hourly).
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends this when
 * CRON_SECRET is set). Same secret as the landlord batch. Vercel Cron invokes
 * the path with GET, so both GET and POST run the shared handler.
 *
 * Selection: matches where `renter_notified_at IS NULL`, not disqualified,
 * `score >= RENTER_ALERT_MIN_SCORE` (default 90), highest score first. The
 * dispatcher does the per-row validation (image present, suppression, send
 * window, template approved, etc.) and stamps `renter_notified_at` on success
 * so a row is never sent twice.
 *
 * Safety filters (in addition to the dispatcher's): renter is vetted
 * (`submissions_count > 0`), renter is NOT placed (no active tenancy), and the
 * property is active (`is_active = true`).
 *
 * Pacing: at most `RENTER_PER_DAY_CAP` (3) sends per renter per day, and at
 * most ONE send per renter per run (so hourly runs spread sends out and they're
 * never back-to-back).
 *
 * Rate limiting: `RENTER_ALERT_BATCH_SIZE` per run, `RENTER_ALERT_DAILY_CAP`
 * across all template sends today, 1s between sends.
 */
async function run(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })
  }

  const sb = supabaseService()
  const batchSize = Math.max(1, Math.min(parseInt(process.env.RENTER_ALERT_BATCH_SIZE || String(BATCH_SIZE_DEFAULT), 10), 50))
  // Shared global Meta daily template ceiling (landlord + renter), default 250 — the account's
  // real daily limit. Using a lower number here starves renters on a busy outreach day. A
  // RENTER_ALERT_DAILY_CAP env override still wins, but should reflect the true Meta limit.
  const dailyCap = Math.max(1, parseInt(process.env.RENTER_ALERT_DAILY_CAP || String(DAILY_CAP), 10))
  const minScore = RENTER_MIN_SCORE

  const { data: org } = await sb.from('organizations').select('id').limit(1).single()
  if (!org) return NextResponse.json({ ok: true, sent: 0, skipped: 0, reason: 'no_org' })
  const orgId = org.id

  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)
  const dayStartIso = dayStart.toISOString()

  // Global Meta daily limit guard: total templates (landlord + renter) sent today vs the 250/day cap.
  const sentToday = await templatesSentToday(orgId)
  if (sentToday >= dailyCap) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, reason: 'daily_cap_hit', sent_today: sentToday })
  }

  const limit = Math.min(batchSize, dailyCap - sentToday)

  // Scope candidates to renters who can actually receive an alert — VETTED (filled the
  // questionnaire) and NOT placed (no active tenancy). This MUST happen at the DB level: the
  // matches table holds many high-scoring matches on UNVETTED renters, so a plain score-ordered
  // fetch fills its whole window with renters we can never send to and starves the vetted ones
  // (observed: a run skipping 84/84 as "unvetted"). The per-row JS checks below stay as defense.
  const { data: vettedRows0 } = await sb.from('renters').select('id').gt('submissions_count', 0)
  const vettedIds0 = (vettedRows0 || []).map(r => r.id as string)
  const { data: placedRows0 } = await sb
    .from('tenancies').select('renter_id').eq('org_id', orgId).eq('status', 'active')
  const placedSet0 = new Set((placedRows0 || []).map(t => t.renter_id as string))
  const eligibleRenterIds = vettedIds0.filter(id => !placedSet0.has(id))
  if (eligibleRenterIds.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, reason: 'no_eligible_renters' })
  }

  const { data: candidates, error } = await sb
    .from('matches')
    .select('id, renter_id, property_id, score')
    .eq('org_id', orgId)
    .is('renter_notified_at', null)
    .eq('is_disqualified', false)
    .gte('score', minScore)
    .in('renter_id', eligibleRenterIds) // only vetted, not-placed renters enter the score window
    .order('score', { ascending: false })
    .limit(limit * 5) // over-fetch — some still fail per-row dispatcher validation / property checks

  if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })

  const allRows = candidates || []

  // Per-run throughput is bounded by DISTINCT eligible renters, not `limit`: the
  // loop sends at most one alert per renter per run. If a few renters each have
  // many >=90 matches, the score-ordered window can be dominated by those few and
  // starve the run below `limit`. Collapse to the single TOP match per renter
  // first (rows are already score-desc, so the first occurrence is the best), so
  // the window spans up to `limit*5` DISTINCT renters and a busy day doesn't
  // under-deliver. (Unsent matches roll to the next hourly run — self-healing.)
  const rows: typeof allRows = []
  const seenRenter = new Set<string>()
  for (const c of allRows) {
    const rid = c.renter_id as string | null
    if (!rid) continue
    if (seenRenter.has(rid)) continue
    seenRenter.add(rid)
    rows.push(c)
  }

  // ---- Resolve the safety-filter inputs in bulk (one query each) ----
  const renterIds = Array.from(new Set(rows.map(c => c.renter_id).filter(Boolean))) as string[]
  const propertyIds = Array.from(new Set(rows.map(c => c.property_id).filter(Boolean))) as string[]

  // Vetted renters (submissions_count > 0).
  const vettedRenterIds = new Set<string>()
  if (renterIds.length) {
    const { data: vettedRows } = await sb
      .from('renters')
      .select('id')
      .in('id', renterIds)
      .gt('submissions_count', 0)
    for (const r of vettedRows || []) vettedRenterIds.add(r.id as string)
  }

  // Placed renters (active tenancy) — excluded.
  const placedRenterIds = new Set<string>()
  if (renterIds.length) {
    const { data: tenRows } = await sb
      .from('tenancies')
      .select('renter_id')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .in('renter_id', renterIds)
    for (const t of tenRows || []) {
      if (t.renter_id) placedRenterIds.add(t.renter_id as string)
    }
  }

  // Active properties only.
  const activePropertyIds = new Set<string>()
  if (propertyIds.length) {
    const { data: propRows } = await sb
      .from('properties')
      .select('id')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .in('id', propertyIds)
    for (const p of propRows || []) activePropertyIds.add(p.id as string)
  }

  // How many recommendations each renter already got today (per-renter/day cap).
  const notifiedTodayCount = new Map<string, number>()
  if (renterIds.length) {
    const { data: todayRows } = await sb
      .from('matches')
      .select('renter_id')
      .eq('org_id', orgId)
      .in('renter_id', renterIds)
      .gte('renter_notified_at', dayStartIso)
    for (const r of todayRows || []) {
      if (!r.renter_id) continue
      const rid = r.renter_id as string
      notifiedTodayCount.set(rid, (notifiedTodayCount.get(rid) || 0) + 1)
    }
  }

  const results: Array<{ matchId: string; status: string; reason?: string }> = []
  const sentThisRun = new Set<string>()
  let sent = 0
  let skipped = 0
  let skippedCapped = 0
  let skippedUnvetted = 0
  let skippedPlaced = 0
  let skippedInactiveProp = 0

  for (const c of rows) {
    if (sent >= limit) break
    const renterId = c.renter_id as string
    const propertyId = c.property_id as string

    if (!vettedRenterIds.has(renterId)) {
      skipped++; skippedUnvetted++
      results.push({ matchId: c.id, status: 'skipped', reason: 'unvetted' })
      continue
    }
    if (placedRenterIds.has(renterId)) {
      skipped++; skippedPlaced++
      results.push({ matchId: c.id, status: 'skipped', reason: 'placed' })
      continue
    }
    if (!activePropertyIds.has(propertyId)) {
      skipped++; skippedInactiveProp++
      results.push({ matchId: c.id, status: 'skipped', reason: 'inactive_property' })
      continue
    }
    // One send per renter PER RUN (never back-to-back) + daily cap.
    if (sentThisRun.has(renterId)) {
      skipped++; skippedCapped++
      results.push({ matchId: c.id, status: 'skipped', reason: 'renter_run_cap' })
      continue
    }
    if ((notifiedTodayCount.get(renterId) || 0) >= RENTER_PER_DAY_CAP) {
      skipped++; skippedCapped++
      results.push({ matchId: c.id, status: 'skipped', reason: 'renter_daily_cap' })
      continue
    }

    const r = await dispatchRenterMatchAlert({
      orgId,
      renterId,
      propertyId,
      matchId: c.id,
    })
    if (r.ok) {
      sent++
      sentThisRun.add(renterId)
      notifiedTodayCount.set(renterId, (notifiedTodayCount.get(renterId) || 0) + 1)
      results.push({ matchId: c.id, status: 'sent' })
    } else {
      skipped++
      results.push({ matchId: c.id, status: 'skipped', reason: `${r.code}:${r.message}` })
    }
    if (sent < limit) await sleep(1000)
  }

  return NextResponse.json({
    ok: true,
    sent,
    skipped,
    skippedCapped,
    skippedUnvetted,
    skippedPlaced,
    skippedInactiveProp,
    daily_cap: dailyCap,
    min_score: minScore,
    sent_today_before: sentToday || 0,
    results,
  })
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
