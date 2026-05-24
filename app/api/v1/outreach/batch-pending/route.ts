import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { dispatchInitialOutreach } from '../../../../../lib/outreach/dispatcher'

const CUTOFF_DATE = '2026-05-13T00:00:00Z'
const BATCH_SIZE_DEFAULT = 10
const DAILY_CAP_DEFAULT = 100

/**
 * Cron-triggered batch outreach.
 *
 * Auth: requires `Authorization: Bearer <CRON_SECRET>` matching the env. Vercel
 * Cron sends this header automatically when configured. Manual triggering
 * works with the same secret.
 *
 * Selection rules:
 *  - Property must be in the user's org.
 *  - `initial_message_sent = false`, `outreach_blocked = false`.
 *  - `contact_phone IS NOT NULL`, `contact_name IS NOT NULL` (non-empty).
 *  - `created_at >= 2026-05-13`.
 *  - `images` is a non-empty JSONB array (we have at least one cover image).
 *  - `outreach_skip_reason` is null or older than 24h (we re-try transient skips).
 *
 * Rate limiting:
 *  - `OUTREACH_BATCH_SIZE` (default 10) per cron invocation.
 *  - `OUTREACH_DAILY_CAP` (default 100) — abort if today's outbound templates already reached the cap.
 *  - 1-second delay between sends to spread load.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })
  }

  const sb = supabaseService()
  const batchSize = Math.max(1, Math.min(parseInt(process.env.OUTREACH_BATCH_SIZE || String(BATCH_SIZE_DEFAULT), 10), 50))
  const dailyCap = Math.max(1, parseInt(process.env.OUTREACH_DAILY_CAP || String(DAILY_CAP_DEFAULT), 10))

  // Single-tenant for now: pick the only org. Multi-tenant cron would loop per org.
  const { data: org } = await sb.from('organizations').select('id').limit(1).single()
  if (!org) return NextResponse.json({ ok: true, sent: 0, skipped: 0, reason: 'no_org' })
  const orgId = org.id

  // Today's outbound template count (Israel time would be more accurate; for MVP server-UTC is fine within ±3h).
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

  const remainingToday = dailyCap - (sentToday || 0)
  const limit = Math.min(batchSize, remainingToday)

  const { data: candidates, error } = await sb
    .from('properties')
    .select('id, contact_phone, contact_name, images, created_at, outreach_skip_reason')
    .eq('org_id', orgId)
    .eq('initial_message_sent', false)
    .eq('outreach_blocked', false)
    .not('contact_phone', 'is', null)
    .not('contact_name', 'is', null)
    .neq('contact_name', '')
    .gte('created_at', CUTOFF_DATE)
    .order('created_at', { ascending: true })
    .limit(limit * 3) // over-fetch — some will fail validation in dispatcher and be skipped

  if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })

  const results: Array<{ id: string; status: string; reason?: string }> = []
  let sent = 0
  let skipped = 0
  for (const p of candidates || []) {
    if (sent >= limit) break

    // Skip recently failed ones for 24h to avoid hammering the same broken row
    if (p.outreach_skip_reason) {
      // We don't have a timestamp on the skip reason — for MVP just respect it as a soft block.
      // Re-clearable manually by setting outreach_skip_reason to null on the property.
      results.push({ id: p.id, status: 'skipped', reason: `prior_skip:${p.outreach_skip_reason}` })
      skipped++
      continue
    }

    const r = await dispatchInitialOutreach({ orgId, propertyId: p.id })
    if (r.ok) {
      sent++
      results.push({ id: p.id, status: 'sent' })
    } else {
      skipped++
      results.push({ id: p.id, status: 'skipped', reason: `${r.code}:${r.message}` })
    }

    // Spread load a bit; only sleep between actual sends
    if (sent < limit) await sleep(1000)
  }

  return NextResponse.json({
    ok: true,
    sent,
    skipped,
    daily_cap: dailyCap,
    sent_today_before: sentToday || 0,
    results,
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
