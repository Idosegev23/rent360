import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { dispatchRenterMatchAlert } from '../../../../../lib/outreach/renter-alert'

const BATCH_SIZE_DEFAULT = 20
const DAILY_CAP_DEFAULT = 50
const MIN_SCORE_DEFAULT = 70 // score is 0-100; only strong matches alert the renter

/**
 * Cron-triggered batch of renter match alerts.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends this when
 * CRON_SECRET is set). Same secret as the landlord batch.
 *
 * Selection: matches where `renter_notified_at IS NULL`, not disqualified,
 * `score >= RENTER_ALERT_MIN_SCORE`, highest score first. The dispatcher does
 * the per-row validation (image present, suppression, template approved, etc.)
 * and stamps `renter_notified_at` on success so a row is never sent twice.
 *
 * Rate limiting: `RENTER_ALERT_BATCH_SIZE` per run, `RENTER_ALERT_DAILY_CAP`
 * across all template sends today, 1s between sends.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })
  }

  const sb = supabaseService()
  const batchSize = Math.max(1, Math.min(parseInt(process.env.RENTER_ALERT_BATCH_SIZE || String(BATCH_SIZE_DEFAULT), 10), 50))
  const dailyCap = Math.max(1, parseInt(process.env.RENTER_ALERT_DAILY_CAP || String(DAILY_CAP_DEFAULT), 10))
  const minScore = parseFloat(process.env.RENTER_ALERT_MIN_SCORE || String(MIN_SCORE_DEFAULT))

  const { data: org } = await sb.from('organizations').select('id').limit(1).single()
  if (!org) return NextResponse.json({ ok: true, sent: 0, skipped: 0, reason: 'no_org' })
  const orgId = org.id

  // Today's outbound template count (shared cap across landlord + renter sends).
  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)
  const { count: sentToday } = await sb
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('direction', 'out')
    .eq('meta_message_type', 'template')
    .gte('created_at', dayStart.toISOString())

  if ((sentToday || 0) >= dailyCap) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, reason: 'daily_cap_hit', sent_today: sentToday })
  }

  const limit = Math.min(batchSize, dailyCap - (sentToday || 0))

  const { data: candidates, error } = await sb
    .from('matches')
    .select('id, renter_id, property_id, score')
    .eq('org_id', orgId)
    .is('renter_notified_at', null)
    .eq('is_disqualified', false)
    .gte('score', minScore)
    .order('score', { ascending: false })
    .limit(limit * 3) // over-fetch — some fail dispatcher validation

  if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })

  const results: Array<{ matchId: string; status: string; reason?: string }> = []
  let sent = 0
  let skipped = 0
  for (const c of candidates || []) {
    if (sent >= limit) break
    const r = await dispatchRenterMatchAlert({
      orgId,
      renterId: c.renter_id,
      propertyId: c.property_id,
      matchId: c.id,
    })
    if (r.ok) {
      sent++
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
    daily_cap: dailyCap,
    min_score: minScore,
    sent_today_before: sentToday || 0,
    results,
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
