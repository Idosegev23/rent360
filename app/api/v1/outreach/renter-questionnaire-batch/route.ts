import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrg } from '../../../../../lib/outreach/admin-context'
import { supabaseService } from '../../../../../lib/supabase'
import { sendTemplate, normalizePhone } from '../../../../../lib/whatsapp/meta-provider'
import { isSuppressed } from '../../../../../lib/outreach/suppression'
import { DAILY_CAP, MANUAL_BATCH_MAX, templatesSentToday, sleepJitter } from '../../../../../lib/outreach/governance'

/**
 * Send the renter INTAKE opener (renter_intake_invite_v1) to a reviewed set of renters — a
 * conversation starter with a "כן, בוא נתחיל" quick-reply. When the renter taps it, the inbound
 * webhook routes the renter thread (tags.audience='renter') to the intake bot, which interviews
 * them in WhatsApp. Enforces the shared daily cap + per-click ceiling, skips suppressed phones,
 * spaces sends with jitter. Body: { renterIds: string[] }.
 */
export const maxDuration = 180

const TEMPLATE = process.env.RENTER_INTAKE_TEMPLATE || 'renter_intake_invite_v1'
const TEMPLATE_LANG = 'he'

export async function POST(req: NextRequest) {
  const ctx = await requireAdminOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { orgId } = ctx

  let body: { renterIds?: unknown } = {}
  try { body = await req.json() } catch {/* empty */}
  const renterIds = Array.isArray(body.renterIds) ? body.renterIds.filter((x): x is string => typeof x === 'string') : []
  if (renterIds.length === 0) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'renterIds required' } }, { status: 400 })
  }

  const sb = supabaseService()

  // Gate on Meta approval (the template is submitted but starts PENDING).
  const { data: tpl } = await sb.from('whatsapp_templates').select('status').eq('name', TEMPLATE).eq('language', TEMPLATE_LANG).maybeSingle()
  if (!tpl || tpl.status !== 'approved') {
    return NextResponse.json({ ok: false, reason: 'template_not_approved', templateStatus: tpl?.status || 'missing', sent: 0, skipped: 0, results: [] })
  }

  // ---- Idempotency: drop renters who already received the intake invite ----
  // This makes the send a clean batch-of-50 — the operator can click repeatedly and each click
  // sends to the NEXT uninvited 50, never re-messaging the same people (marketing template, so a
  // duplicate annoys the renter, wastes the daily cap, and hurts the Meta quality rating).
  const { data: renterRows } = await sb.from('renters').select('id, phone').in('id', renterIds)
  const phoneByRenter = new Map<string, string>()
  for (const r of renterRows || []) if (r.phone) phoneByRenter.set(r.id as string, normalizePhone(r.phone))
  const phones = Array.from(new Set(Array.from(phoneByRenter.values())))
  const threadIdByPhone = new Map<string, string>()
  if (phones.length) {
    const { data: threadRows } = await sb.from('threads').select('id, phone').eq('org_id', orgId).in('phone', phones)
    for (const t of threadRows || []) if (t.phone) threadIdByPhone.set(t.phone as string, t.id as string)
  }
  const invitedThreadIds = new Set<string>()
  const threadIds = Array.from(new Set(Array.from(threadIdByPhone.values())))
  if (threadIds.length) {
    const { data: invMsgs } = await sb.from('messages').select('thread_id').eq('template_name', TEMPLATE).in('thread_id', threadIds)
    for (const m of invMsgs || []) if (m.thread_id) invitedThreadIds.add(m.thread_id as string)
  }
  const alreadyInvited = renterIds.filter(rid => {
    const ph = phoneByRenter.get(rid); const tid = ph ? threadIdByPhone.get(ph) : undefined
    return tid && invitedThreadIds.has(tid)
  })
  const alreadyInvitedSet = new Set(alreadyInvited)
  const pending = renterIds.filter(rid => !alreadyInvitedSet.has(rid))

  const sentToday = await templatesSentToday(orgId)
  const remaining = DAILY_CAP - sentToday
  if (remaining <= 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, alreadyInvited: alreadyInvited.length, remainingToInvite: pending.length, reason: 'daily_cap_hit', dailyCap: DAILY_CAP, sentTodayBefore: sentToday, results: [] })
  }
  // Per-click batch ceiling = 50 (MANUAL_BATCH_MAX), also bounded by the remaining daily cap.
  const limit = Math.min(pending.length, remaining, MANUAL_BATCH_MAX)

  const results: Array<{ renterId: string; status: 'sent' | 'skipped'; reason?: string }> = []
  let sent = 0, skipped = 0

  for (const renterId of pending) {
    if (sent >= limit) break
    try {
      const { data: renter } = await sb.from('renters').select('id, first_name, phone').eq('id', renterId).maybeSingle()
      if (!renter?.phone) { skipped++; results.push({ renterId, status: 'skipped', reason: 'no_phone' }); continue }
      const phone = normalizePhone(renter.phone)
      if (await isSuppressed(orgId, phone)) { skipped++; results.push({ renterId, status: 'skipped', reason: 'suppressed' }); continue }

      const components = [
        { type: 'body' as const, parameters: [{ type: 'text' as const, text: (renter.first_name || 'שלום').slice(0, 40) }] },
      ]
      const r = await sendTemplate({ to: phone, name: TEMPLATE, language: TEMPLATE_LANG, components })

      // Record on the renter's thread so it shows in the inbox + counts toward the daily cap.
      const thread = await upsertRenterThread(sb, orgId, phone, renterId, renter.first_name)
      if (thread?.id) {
        await sb.from('messages').insert({
          org_id: orgId, thread_id: thread.id, channel: 'whatsapp', direction: 'out', body: null,
          status: 'sent', external_id: r.messageId, meta_message_type: 'template',
          template_name: TEMPLATE, template_params: { first_name: renter.first_name },
        })
        await sb.from('threads').update({ last_outbound_at: new Date().toISOString(), last_message_at: new Date().toISOString() }).eq('id', thread.id)
      }
      sent++
      results.push({ renterId, status: 'sent' })
      if (sent < limit) await sleepJitter()
    } catch (err) {
      skipped++
      results.push({ renterId, status: 'skipped', reason: err instanceof Error ? err.message.slice(0, 80) : 'send_failed' })
    }
  }

  return NextResponse.json({
    ok: true,
    sent,
    skipped,
    alreadyInvited: alreadyInvited.length,
    remainingToInvite: Math.max(0, pending.length - sent), // uninvited renters still waiting for a future batch
    batchMax: MANUAL_BATCH_MAX,
    sentTodayBefore: sentToday,
    dailyCap: DAILY_CAP,
    capReached: sent >= remaining,
    results,
  })
}

async function upsertRenterThread(sb: ReturnType<typeof supabaseService>, orgId: string, phone: string, renterId: string, firstName?: string | null): Promise<{ id: string } | null> {
  const { data: existing } = await sb.from('threads').select('id, tags').eq('org_id', orgId).eq('phone', phone).maybeSingle()
  if (existing) return existing
  const { data: created } = await sb.from('threads').insert({
    org_id: orgId, phone, channel: 'whatsapp', status: 'awaiting_reply',
    tags: { audience: 'renter', renter_id: renterId, ...(firstName ? { renter_name: firstName } : {}) },
  }).select('id').single()
  return created || null
}
