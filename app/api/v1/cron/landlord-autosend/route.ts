import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { canSendNow } from '../../../../../lib/time/send-window'
import { israelDayRangeUTC } from '../../../../../lib/time/israel'
import { dispatchInitialOutreach } from '../../../../../lib/outreach/dispatcher'
import {
  DAILY_CAP, templatesSentToday, sleepJitter, loadApprovedPropertyIds, loadSuppressedPhones,
} from '../../../../../lib/outreach/governance'
import { normalizePhone } from '../../../../../lib/outreach/phone'
import { runQuota } from '../../../../../lib/outreach/autosend-pacing'

/**
 * Every-15-minutes cron: automatic first-touch outreach to the "hot" landlord queue (/outreach →
 * גיוס בעלי דירות), paced like the renewal cron (lib/outreach/autosend-pacing.ts).
 *
 * Daily target LANDLORD_AUTOSEND_DAILY (default 100 — client decision 2026-09-16), GLOBAL across orgs
 * (one WhatsApp number) and counting manual sends of the landlord_outreach templates too. Each run:
 *  - does nothing unless LANDLORD_AUTOSEND_ENABLED=true (GET ?dryRun=1 still previews, never sends);
 *  - checks canSendNow() before EVERY send — dispatchInitialOutreach does not gate the window itself;
 *  - never exceeds an org's shared template DAILY_CAP;
 *  - picks the /outreach landlord queue, newest listing first, no age limit (client decision), minus:
 *      · already-approved properties and suppressed phones;
 *      · non-mobile and 055 numbers — listing-site virtual numbers, 99–100% undeliverable in our
 *        history (client decision to skip them automatically; manual sends still allowed);
 *      · any phone we have EVER sent to (a thread with last_outbound_at). This is load-bearing: the
 *        WhatsApp webhook returns a property whose first-touch FAILED to the queue, and one owner can
 *        have several listings — without this, the same number would be retried every day;
 *      · properties with an outreach_skip_reason (the dispatcher stamps unusable rows).
 *  - sends through dispatchInitialOutreach with the batch button's template choice (auto_quality).
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`. Allowlisted in middleware.
 */
export const maxDuration = 120

const DAILY_TARGET = Number(process.env.LANDLORD_AUTOSEND_DAILY || 100)
const MAX_PER_RUN = Number(process.env.LANDLORD_AUTOSEND_MAX_PER_RUN || 6)
const SCAN_PAGE = 200
const SCAN_MAX_PAGES = 10
// Results that mean "nothing can send right now" — end the run instead of burning through the queue.
const STOP_CODES = new Set(['TEMPLATE_MISSING', 'TEMPLATE_NOT_APPROVED', 'META_SEND_FAILED', 'DB_ERROR'])

type SB = ReturnType<typeof supabaseService>
type Candidate = { propertyId: string; phone: string }
type OrgReport = {
  orgId: string
  quota: number
  scanned: number
  sent: number
  skipped: string[]
  stoppedOn: string | null
  wouldSend: string[] | null
}

/** A real Israeli mobile (9725X…) that is not 055 — see the header for why 055 and 07x are skipped. */
function isDeliverableMobile(phone: string): boolean {
  return /^9725\d{8}$/.test(phone) && !phone.startsWith('97255')
}

/** Newest-first scan of the landlord queue, keeping one never-contacted deliverable owner per phone. */
async function pickCandidates(sb: SB, orgId: string, want: number): Promise<{ picks: Candidate[]; scanned: number; error: string | null }> {
  const [approved, suppressed] = await Promise.all([loadApprovedPropertyIds(orgId), loadSuppressedPhones(orgId)])
  const picks: Candidate[] = []
  const seenPhones = new Set<string>()
  let scanned = 0

  for (let page = 0; page < SCAN_MAX_PAGES && picks.length < want; page++) {
    const { data, error } = await sb
      .from('properties')
      .select('id, contact_phone')
      .eq('org_id', orgId)
      .eq('initial_message_sent', false)
      .eq('outreach_blocked', false)
      .is('outreach_skip_reason', null)
      .not('contact_phone', 'is', null)
      .not('contact_name', 'is', null)
      .neq('contact_name', '')
      .or('is_active.is.null,is_active.eq.true')
      .order('created_at', { ascending: false })
      .range(page * SCAN_PAGE, (page + 1) * SCAN_PAGE - 1)
    if (error) return { picks, scanned, error: error.message }
    const rows = (data || []) as Array<{ id: string; contact_phone: string }>
    scanned += rows.length

    const fresh: Candidate[] = []
    for (const r of rows) {
      const phone = normalizePhone(r.contact_phone)
      if (seenPhones.has(phone)) continue // one owner, one message — even across several listings
      seenPhones.add(phone)
      if (approved.has(r.id) || suppressed.has(phone) || !isDeliverableMobile(phone)) continue
      fresh.push({ propertyId: r.id, phone })
    }

    if (fresh.length > 0) {
      const { data: threads, error: threadErr } = await sb
        .from('threads')
        .select('phone')
        .eq('org_id', orgId)
        .in('phone', fresh.map(c => c.phone))
        .not('last_outbound_at', 'is', null)
      if (threadErr) return { picks, scanned, error: threadErr.message }
      const contacted = new Set((threads || []).map(t => normalizePhone(t.phone as string)))
      for (const c of fresh) {
        if (picks.length >= want) break
        if (!contacted.has(c.phone)) picks.push(c)
      }
    }
    if (rows.length < SCAN_PAGE) break
  }
  return { picks, scanned, error: null }
}

async function run(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })
  }
  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'
  if (!dryRun && process.env.LANDLORD_AUTOSEND_ENABLED !== 'true') {
    return NextResponse.json({ ok: true, idle: 'disabled' })
  }

  const now = new Date()
  const gate = await canSendNow(now)
  if (!gate.ok && !dryRun) return NextResponse.json({ ok: true, idle: 'send_window', reason: gate.reason })

  const sb = supabaseService()
  const { startUTC } = israelDayRangeUTC()
  const [orgsRes, sentRes] = await Promise.all([
    sb.from('organizations').select('id'),
    sb.from('messages').select('id', { count: 'exact', head: true })
      .eq('direction', 'out').like('template_name', 'landlord_outreach%').gte('created_at', startUTC.toISOString()),
  ])
  const dbErr = orgsRes.error || sentRes.error
  if (dbErr) return NextResponse.json({ error: { code: 'DB_ERROR', message: dbErr.message } }, { status: 500 })

  const sentToday = sentRes.count || 0
  let runLeft = runQuota(DAILY_TARGET - sentToday, now, MAX_PER_RUN)
  const report: OrgReport[] = []

  for (const { id: orgId } of (orgsRes.data || []) as Array<{ id: string }>) {
    if (runLeft <= 0) break
    const sharedLeft = Math.max(0, DAILY_CAP - (await templatesSentToday(orgId)))
    const entry: OrgReport = {
      orgId, quota: Math.min(runLeft, sharedLeft), scanned: 0, sent: 0, skipped: [], stoppedOn: null, wouldSend: null,
    }
    report.push(entry)
    if (entry.quota <= 0) continue

    // A few extra so rows the dispatcher skips (bad name, suppressed since loading) don't leave the run short.
    const { picks, scanned, error } = await pickCandidates(sb, orgId, entry.quota + 4)
    entry.scanned = scanned
    if (error) { entry.stoppedOn = `DB_ERROR: ${error}`; continue }

    if (dryRun) {
      entry.wouldSend = picks.slice(0, entry.quota).map(c => c.propertyId)
      runLeft -= entry.wouldSend.length
      continue
    }

    for (const c of picks) {
      if (entry.sent >= entry.quota) break
      const window = await canSendNow()
      if (!window.ok) { entry.stoppedOn = `SEND_WINDOW: ${window.reason || ''}`; break }
      const r = await dispatchInitialOutreach({ orgId, propertyId: c.propertyId, templateChoice: 'auto_quality' })
      if (r.ok) {
        entry.sent++
        if (entry.sent < entry.quota) await sleepJitter()
      } else if (STOP_CODES.has(r.code)) {
        entry.stoppedOn = `${r.code}: ${r.message}`
        break
      } else {
        entry.skipped.push(`${c.propertyId}: ${r.code}`)
      }
    }
    runLeft -= entry.sent
    if (entry.stoppedOn) console.error(`[landlord-autosend] org=${orgId} stopped: ${entry.stoppedOn}`)
  }

  return NextResponse.json({ ok: true, dryRun, sendWindow: gate, dailyTarget: DAILY_TARGET, sentToday, report })
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
