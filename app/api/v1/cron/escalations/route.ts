import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { syncTemplateStatuses } from '../../../../../lib/whatsapp/template-sync'
import { canSendNow } from '../../../../../lib/time/send-window'
import { escalationTargets } from '../../../../../lib/alerts/escalation-recipients'
import { notifyStaffEscalation } from '../../../../../lib/alerts/staff-whatsapp'

/**
 * Hourly cron: chase undocumented human_takeover conversations.
 *
 * Anchor: the most recent `conversation_alerts` (type='handoff') per thread — its `created_at`
 * is when the conversation was handed to a human. A thread is "documented" (and skipped) if the
 * alert was read, or any non-system, non-escalation `activity` was logged on it after the handoff.
 *
 *  - ≥24h undocumented → WhatsApp שי (L1), stamp activity kind='escalation_reminder_24h'.
 *  - ≥48h undocumented → WhatsApp זיו (L2), stamp activity kind='escalation_reminder_48h'.
 *
 * Dedupe is entirely those activity rows keyed to "since the latest handoff", so a re-handoff
 * (newer anchor) re-arms both levels. Respects canSendNow() (09:00–21:00, never Shabbat/חג) and
 * the template-approval gate. GET ?dryRun=1 returns the would-send list without sending/stamping.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`. Allowlisted in middleware.
 */
export const maxDuration = 120

const DOC_IGNORED_KINDS = new Set(['escalation_reminder_24h', 'escalation_reminder_48h', 'system'])
const LOOKBACK_DAYS = 30

type Plan = {
  threadId: string
  ageHours: number
  levels: Array<24 | 48>
  contactLabel: string
  contactPhone: string
  title: string
  reason: string
}

async function run(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })
  }
  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'
  const sb = supabaseService()

  // Cold-start / backlog guards. Escalation is a TIMELY nudge (24h/48h), not eternal nagging:
  //  - MAX_AGE_HOURS: never chase a handoff older than this (stale backlog is surfaced in the inbox,
  //    not by blasting staff). Also what prevents a first-run spam-bomb of long-stuck threads.
  //  - MAX_SENDS_PER_RUN: hard cap on WhatsApps per run so a burst can never flood שי/זיו.
  const MAX_AGE_HOURS = Number(process.env.ESCALATION_MAX_AGE_HOURS || 96)
  const MAX_SENDS_PER_RUN = Number(process.env.ESCALATION_MAX_SENDS_PER_RUN || 5)

  // Pick up any freshly-approved template so the dedicated escalation template starts sending.
  if (!dryRun) await syncTemplateStatuses()

  const nowMs = Date.now()
  const sinceIso = new Date(nowMs - LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString()

  // Latest handoff alert per thread within the lookback window (desc → first seen is newest).
  const { data: alertsRaw } = await sb
    .from('conversation_alerts')
    .select('thread_id, org_id, read_at, created_at, payload')
    .eq('type', 'handoff')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(1000)
  const latestByThread = new Map<string, { org_id: string; read_at: string | null; created_at: string; payload: any }>()
  for (const a of alertsRaw || []) {
    if (!a.thread_id || latestByThread.has(a.thread_id)) continue
    latestByThread.set(a.thread_id, { org_id: a.org_id, read_at: a.read_at, created_at: a.created_at, payload: a.payload })
  }
  const threadIds = [...latestByThread.keys()]
  if (threadIds.length === 0) {
    return NextResponse.json({ ok: true, dryRun, scanned: 0, l1_sent: 0, l2_sent: 0, skipped: 0, plans: [] })
  }

  // Only threads still in human_takeover are open handoffs.
  const { data: threads } = await sb
    .from('threads')
    .select('id, status, phone, property_id')
    .in('id', threadIds)
  const openThreads = (threads || []).filter(t => t.status === 'human_takeover')
  const openIds = openThreads.map(t => t.id)
  const threadById = new Map(openThreads.map(t => [t.id, t]))

  // Bulk-load activity + property titles for the open threads.
  const { data: acts } = openIds.length
    ? await sb
        .from('activity')
        .select('entity_id, kind, created_at')
        .eq('entity_type', 'thread')
        .in('entity_id', openIds)
        .gte('created_at', sinceIso)
    : { data: [] as Array<{ entity_id: string; kind: string; created_at: string }> }

  const propertyIds = [...new Set(openThreads.map(t => t.property_id).filter(Boolean))] as string[]
  const { data: props } = propertyIds.length
    ? await sb.from('properties').select('id, title, street, city, contact_name, contact_phone').in('id', propertyIds)
    : { data: [] as any[] }
  const propById = new Map((props || []).map(p => [p.id, p]))

  const send = dryRun ? { ok: false as const, reason: 'dry_run' } : await canSendNow()
  const targets = await escalationTargets()

  const plans: Plan[] = []
  let scanned = 0
  let l1Sent = 0
  let l2Sent = 0
  let skipped = 0
  let staleSkipped = 0
  let sentThisRun = 0
  let capReached = false
  const errors: Array<{ threadId: string; error: string }> = []

  // Oldest-eligible first so the per-run cap drains the most-overdue threads first.
  const ordered = [...openThreads].sort((a, b) => {
    const ta = new Date(latestByThread.get(a.id)!.created_at).getTime()
    const tb = new Date(latestByThread.get(b.id)!.created_at).getTime()
    return ta - tb
  })

  for (const t of ordered) {
    scanned++
    const meta = latestByThread.get(t.id)!
    const T = meta.created_at
    const tMs = new Date(T).getTime()
    const threadActs = (acts || []).filter(a => a.entity_id === t.id && a.created_at > T)
    const documented = meta.read_at != null || threadActs.some(a => !DOC_IGNORED_KINDS.has(a.kind))
    if (documented) { skipped++; continue }

    const ageHours = (nowMs - tMs) / 3600000
    // Stale backlog — past the escalation horizon. Not the escalation cron's job (visible in inbox).
    if (ageHours > MAX_AGE_HOURS) { staleSkipped++; continue }

    const sent24 = threadActs.some(a => a.kind === 'escalation_reminder_24h')
    const sent48 = threadActs.some(a => a.kind === 'escalation_reminder_48h')

    const due: Array<24 | 48> = []
    if (ageHours >= 24 && !sent24 && targets.l1) due.push(24)
    if (ageHours >= 48 && !sent48 && targets.l2) due.push(48)
    if (due.length === 0) { skipped++; continue }

    const p = t.property_id ? propById.get(t.property_id) : null
    const contactLabel = p?.contact_name || 'לקוח'
    const contactPhone = p?.contact_phone || t.phone || '-'
    const title = [p?.street, p?.city].filter(Boolean).join(', ') || p?.title || 'שיחה'
    const reason = (meta.payload && typeof meta.payload === 'object' && meta.payload.reason) ? String(meta.payload.reason) : 'ממתין לטיפול'

    plans.push({ threadId: t.id, ageHours: Math.round(ageHours), levels: due, contactLabel, contactPhone, title, reason })

    if (dryRun || !send.ok) continue

    for (const level of due) {
      if (sentThisRun >= MAX_SENDS_PER_RUN) { capReached = true; break }
      const to = level === 24 ? targets.l1! : targets.l2!
      const ageLabel = `${Math.round(ageHours)} שעות`
      try {
        const res = await notifyStaffEscalation({
          orgId: meta.org_id, level, to: to.phone, staffName: to.name,
          threadId: t.id, contactLabel, contactPhone, title, ageLabel, reason,
        })
        if (res.sent > 0) {
          sentThisRun++
          if (level === 24) l1Sent++; else l2Sent++
          await sb.from('activity').insert({
            org_id: meta.org_id,
            entity_type: 'thread',
            entity_id: t.id,
            author_user_id: null,
            kind: level === 24 ? 'escalation_reminder_24h' : 'escalation_reminder_48h',
            body: `תזכורת אסקלציה נשלחה ל${to.name} (${Math.round(ageHours)} שעות ללא תיעוד)`,
            metadata: { level, to: to.phone, template: res.template },
          })
        } else if (res.skipped) {
          errors.push({ threadId: t.id, error: `level_${level}:${res.skipped}` })
        }
      } catch (err) {
        errors.push({ threadId: t.id, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    sendWindow: send.ok ? 'open' : (dryRun ? 'dry_run' : ((send as any).reason || 'closed')),
    maxAgeHours: MAX_AGE_HOURS,
    scanned,
    candidates: plans.length,
    l1_sent: l1Sent,
    l2_sent: l2Sent,
    skipped,
    staleSkipped,
    ...(capReached ? { capReached: true, maxSendsPerRun: MAX_SENDS_PER_RUN } : {}),
    ...(errors.length ? { errors } : {}),
    plans,
  })
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
