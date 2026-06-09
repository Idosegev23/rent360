import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrg } from '../../../../../lib/outreach/admin-context'
import { dispatchInitialOutreach } from '../../../../../lib/outreach/dispatcher'
import { DAILY_CAP, MANUAL_BATCH_MAX, templatesSentToday, sleepJitter } from '../../../../../lib/outreach/governance'

/**
 * Send the landlord first-touch outreach to a reviewed set of properties.
 *
 * This is the BATCH path → it enforces the shared daily cap and a per-click ceiling,
 * and spaces sends with jitter. (Single manual override = POST /outreach/send-initial,
 * which is cap-free.) The dispatcher still enforces dedup, suppression, and template
 * approval per row, and reports skips.
 *
 * Body: `{ propertyIds: string[] }`.
 */
// A 50-send batch with jitter can run ~2.5 min; give it room (Pro allows up to 300s).
export const maxDuration = 180

export async function POST(req: NextRequest) {
  const ctx = await requireAdminOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { orgId } = ctx

  let body: { propertyIds?: unknown; prefer?: unknown } = {}
  try {
    body = await req.json()
  } catch {/* empty body → no-op below */}

  const propertyIds = Array.isArray(body.propertyIds)
    ? body.propertyIds.filter((x): x is string => typeof x === 'string')
    : []
  if (propertyIds.length === 0) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'propertyIds required' } }, { status: 400 })
  }

  // 'personalized' (default) → rich when the hook is trustworthy, else basic. 'basic' → always basic.
  const templateChoice = body.prefer === 'basic' ? 'basic' : 'auto_quality'

  const sentToday = await templatesSentToday(orgId)
  const remaining = DAILY_CAP - sentToday
  if (remaining <= 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, reason: 'daily_cap_hit', sentTodayBefore: sentToday, dailyCap: DAILY_CAP, results: [] })
  }

  const limit = Math.min(propertyIds.length, remaining, MANUAL_BATCH_MAX)

  const results: Array<{ propertyId: string; status: 'sent' | 'skipped'; reason?: string }> = []
  let sent = 0
  let skipped = 0
  for (const propertyId of propertyIds) {
    if (sent >= limit) break
    const r = await dispatchInitialOutreach({ orgId, propertyId, templateChoice })
    if (r.ok) {
      sent++
      results.push({ propertyId, status: 'sent' })
    } else {
      skipped++
      results.push({ propertyId, status: 'skipped', reason: `${r.code}: ${r.message}` })
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
