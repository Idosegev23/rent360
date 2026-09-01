import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrg } from '../../../../../lib/outreach/admin-context'
import { dispatchRenewalOutreach } from '../../../../../lib/outreach/renewal-dispatcher'
import { DAILY_CAP, MANUAL_BATCH_MAX, templatesSentToday, sleepJitter } from '../../../../../lib/outreach/governance'

/**
 * Send the renewal outreach to a reviewed set of `renewal_leads` rows.
 *
 * Mirrors `landlord-send-batch/route.ts`: this is the BATCH path → it enforces the shared daily
 * cap and a per-click ceiling, and spaces sends with jitter. (Single manual override =
 * POST /renewals/send-one, which is cap-free.) `dispatchRenewalOutreach` itself still enforces
 * dedup, suppression, template approval, and the send-window per row, and reports skips — while
 * both renewal templates are `pending` at Meta every row in the batch will report
 * `TEMPLATE_NOT_APPROVED` and nothing will actually send.
 *
 * Body: `{ leadIds: string[] }`.
 */
// A 50-send batch with jitter can run ~2.5 min; give it room (Pro allows up to 300s).
export const maxDuration = 180

export async function POST(req: NextRequest) {
  const ctx = await requireAdminOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { orgId } = ctx

  let body: { leadIds?: unknown } = {}
  try {
    body = await req.json()
  } catch {/* empty body → no-op below */}

  const leadIds = Array.isArray(body.leadIds)
    ? body.leadIds.filter((x): x is string => typeof x === 'string')
    : []
  if (leadIds.length === 0) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'leadIds required' } }, { status: 400 })
  }

  const sentToday = await templatesSentToday(orgId)
  const remaining = DAILY_CAP - sentToday
  if (remaining <= 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, reason: 'daily_cap_hit', sentTodayBefore: sentToday, dailyCap: DAILY_CAP, results: [] })
  }

  const limit = Math.min(leadIds.length, remaining, MANUAL_BATCH_MAX)

  const results: Array<{ leadId: string; status: 'sent' | 'skipped'; reason?: string }> = []
  let sent = 0
  let skipped = 0
  for (const leadId of leadIds) {
    if (sent >= limit) break
    const r = await dispatchRenewalOutreach({ orgId, leadId })
    if (r.ok) {
      sent++
      results.push({ leadId, status: 'sent' })
      // Deliberate divergence from landlord-send-batch/route.ts: jitter only after a row that
      // actually sent, not after every row including skips. The renewal queue's "select all" can
      // put up to 300 rows in one batch, most of which can be skips (suppressed/blocked/template
      // not approved/etc.) — jittering on every row burns ~2.25s each and can exhaust
      // `maxDuration = 180` before the batch reaches the daily cap or even finishes.
      if (sent < limit) await sleepJitter()
    } else {
      skipped++
      results.push({ leadId, status: 'skipped', reason: `${r.code}: ${r.message}` })
    }
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
