import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { canSendNow, SEND_WINDOW_END_HOUR } from '../../../../../lib/time/send-window'
import { israelDayRangeUTC } from '../../../../../lib/time/israel'
import { dispatchRenewalOutreach } from '../../../../../lib/outreach/renewal-dispatcher'
import { DAILY_CAP, templatesSentToday, sleepJitter } from '../../../../../lib/outreach/governance'
import { renewalDueWindow } from '../../../../../lib/outreach/renewal-shared'

/**
 * Every-15-minutes cron: automatic renewal outreach, paced across the day.
 *
 * The daily target (RENEWAL_AUTOSEND_DAILY, default 100 — client decision 2026-09-14) is spread over
 * the runs left before the send window closes, so sends trickle out all day instead of bursting at
 * 09:00. The target is GLOBAL, not per org: every org sends from the same WhatsApp number, and that
 * number's Meta quality rating is what the pace protects. Manual sends from /renewals count toward
 * it too. Each run:
 *  - does nothing unless RENEWAL_AUTOSEND_ENABLED=true (GET ?dryRun=1 still previews, never sends);
 *  - does nothing outside canSendNow() (09:00–21:00 Israel, never Shabbat/חג);
 *  - never exceeds an org's shared template DAILY_CAP that manual batches and renter alerts draw on;
 *  - picks what the /renewals queue shows (pending, due window, highest score first), minus leads
 *    whose property has no phone — the dispatcher leaves those pending, so they would clog the head;
 *  - sends through dispatchRenewalOutreach, which keeps every per-lead guard (suppression, blocked,
 *    approved property, template approval, dedup).
 * A lead Meta refuses after acceptance (e.g. 131049) stays `sent` and is never retried — client
 * decision 2026-09-14.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`. Allowlisted in middleware.
 */
export const maxDuration = 120

const RUN_EVERY_MIN = 15
const DAILY_TARGET = Number(process.env.RENEWAL_AUTOSEND_DAILY || 100)
const MAX_PER_RUN = Number(process.env.RENEWAL_AUTOSEND_MAX_PER_RUN || 6)
// Results that mean "nothing can send right now" — end the run instead of burning through leads.
const STOP_CODES = new Set(['SEND_WINDOW', 'TEMPLATE_MISSING', 'TEMPLATE_NOT_APPROVED', 'META_SEND_FAILED', 'DB_ERROR'])

type OrgReport = {
  orgId: string
  quota: number
  sent: number
  skipped: string[]
  stoppedOn: string | null
  wouldSend: string[] | null
}

function israelMinutesOfDay(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: string): number => Number(parts.find(p => p.type === type)?.value || 0)
  return get('hour') * 60 + get('minute')
}

/** This run's even share of what is left today: remaining ÷ runs left before the window closes. */
function runQuota(remaining: number, now: Date): number {
  if (remaining <= 0) return 0
  const runsLeft = Math.max(1, Math.ceil((SEND_WINDOW_END_HOUR * 60 - israelMinutesOfDay(now)) / RUN_EVERY_MIN))
  return Math.min(MAX_PER_RUN, Math.round(remaining / runsLeft))
}

async function run(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })
  }
  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'
  if (!dryRun && process.env.RENEWAL_AUTOSEND_ENABLED !== 'true') {
    return NextResponse.json({ ok: true, idle: 'disabled' })
  }

  const now = new Date()
  const gate = await canSendNow(now)
  if (!gate.ok && !dryRun) return NextResponse.json({ ok: true, idle: 'send_window', reason: gate.reason })

  const sb = supabaseService()
  const { startUTC } = israelDayRangeUTC()
  const [orgsRes, sentRes] = await Promise.all([
    sb.from('organizations').select('id'),
    sb.from('renewal_leads').select('id', { count: 'exact', head: true })
      .eq('status', 'sent').gte('sent_at', startUTC.toISOString()),
  ])
  const dbErr = orgsRes.error || sentRes.error
  if (dbErr) return NextResponse.json({ error: { code: 'DB_ERROR', message: dbErr.message } }, { status: 500 })

  const sentToday = sentRes.count || 0
  let runLeft = runQuota(DAILY_TARGET - sentToday, now)
  const { from, to } = renewalDueWindow()
  const report: OrgReport[] = []

  for (const { id: orgId } of (orgsRes.data || []) as Array<{ id: string }>) {
    if (runLeft <= 0) break
    const sharedLeft = Math.max(0, DAILY_CAP - (await templatesSentToday(orgId)))
    const entry: OrgReport = { orgId, quota: Math.min(runLeft, sharedLeft), sent: 0, skipped: [], stoppedOn: null, wouldSend: null }
    report.push(entry)
    if (entry.quota <= 0) continue

    // A few extra candidates so rows the dispatcher skips (suppressed, blocked, bad name) don't
    // leave the run short.
    const { data: leads, error: leadsErr } = await sb
      .from('renewal_leads')
      .select('id, properties!inner(contact_phone)')
      .eq('org_id', orgId)
      .eq('status', 'pending')
      .gte('matures_at', from)
      .lte('matures_at', to)
      .not('properties.contact_phone', 'is', null)
      .order('score', { ascending: false })
      .order('matures_at', { ascending: true })
      .limit(entry.quota * 5)
    if (leadsErr) { entry.stoppedOn = `DB_ERROR: ${leadsErr.message}`; continue }
    const ids = (leads || []).map(l => l.id as string)

    if (dryRun) {
      entry.wouldSend = ids.slice(0, entry.quota)
      runLeft -= entry.wouldSend.length
      continue
    }

    for (const leadId of ids) {
      if (entry.sent >= entry.quota) break
      const r = await dispatchRenewalOutreach({ orgId, leadId })
      if (r.ok) {
        entry.sent++
        if (entry.sent < entry.quota) await sleepJitter()
      } else if (STOP_CODES.has(r.code)) {
        entry.stoppedOn = `${r.code}: ${r.message}`
        break
      } else {
        entry.skipped.push(`${leadId}: ${r.code}`)
      }
    }
    runLeft -= entry.sent
    if (entry.stoppedOn) console.error(`[renewal-autosend] org=${orgId} stopped: ${entry.stoppedOn}`)
  }

  return NextResponse.json({
    ok: true, dryRun, sendWindow: gate, dueWindow: { from, to }, dailyTarget: DAILY_TARGET, sentToday, report,
  })
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
