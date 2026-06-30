/**
 * Tools for the renter reply-bot. The model answers the renter's questions about the matched
 * property from share-safe facts, and uses these tools to act on detected intent:
 *  - express_interest      → renter wants to view / proceed (reuses the shared interest recorder)
 *  - record_not_interested → renter passes on this property
 *  - send_property_link    → (re)send the renter's personal /share link
 *  - handoff_to_human      → anything complex / a request for a person / a new search
 *  - opt_out               → soft "stop messaging me"
 */

import { supabaseService } from '../../supabase'
import { recordRenterInterest } from '../../outreach/renter-interest'
import { recordOptOut } from '../../outreach/suppression'
import { notifyAdminsHandoff } from '../../alerts/admin-whatsapp'
import { viewingSchedulerEnabled, startViewingScheduling } from '../../scheduling/viewing-scheduler'

export type ReplyToolContext = {
  orgId: string
  threadId: string
  renterId: string
  propertyId: string
  matchId: string | null
  phone: string
  shareUrl: string | null
  propertyLabel: string // city · neighborhood — safe, staff-facing label for alerts
  appBaseUrl?: string | undefined
}

export type ToolDefinition = { type: 'function'; name: string; description: string; parameters: Record<string, unknown> }

export const REPLY_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    name: 'express_interest',
    description: 'Call when the renter says they want to SEE the apartment, schedule a viewing, or proceed. Alerts the office so a human arranges a viewing. After calling, tell the renter that someone from the office will contact them shortly to coordinate a viewing.',
    parameters: { type: 'object', properties: { note: { type: 'string', description: 'תמצית קצרה של מה שהשוכר אמר (אופציונלי).' } }, required: [], additionalProperties: false },
  },
  {
    type: 'function',
    name: 'record_not_interested',
    description: 'Call when the renter says this specific apartment is not for them. Records it. Then thank them warmly and let them know we will keep looking for better-fitting apartments.',
    parameters: { type: 'object', properties: { reason: { type: 'string', description: 'הסיבה אם נמסרה (אופציונלי).' } }, required: [], additionalProperties: false },
  },
  {
    type: 'function',
    name: 'send_property_link',
    description: "Get the renter's personal link to the apartment's full details page (photos + the match breakdown). Returns the URL — include it in your reply. Use when the renter lost the link or asks to see more / photos.",
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function',
    name: 'handoff_to_human',
    description: 'Hand off to a human (Ziv) — when the renter asks to speak to a person, raises something beyond this apartment (e.g. wants to change their search / asks about a different apartment), negotiates, or asks something you cannot answer from the given facts.',
    parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'], additionalProperties: false },
  },
  {
    type: 'function',
    name: 'opt_out',
    description: 'Call only if the renter clearly asks to stop receiving messages from us.',
    parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: [], additionalProperties: false },
  },
]

export async function executeReplyTool(name: string, args: any, ctx: ReplyToolContext): Promise<unknown> {
  switch (name) {
    case 'express_interest': return expressInterest(args, ctx)
    case 'record_not_interested': return notInterested(args, ctx)
    case 'send_property_link': return sendLink(ctx)
    case 'handoff_to_human': return handoff(args, ctx)
    case 'opt_out': return optOut(args, ctx)
    default: return { error: `unknown_tool:${name}` }
  }
}

async function expressInterest(args: { note?: string }, ctx: ReplyToolContext) {
  const res = await recordRenterInterest({
    orgId: ctx.orgId,
    renterId: ctx.renterId,
    propertyId: ctx.propertyId,
    threadId: ctx.threadId,
    matchId: ctx.matchId,
    flipToHumanTakeover: false, // keep the bot available for follow-up questions; the office is alerted
    source: 'reply_bot',
  })

  // Smart scheduler (Phase 3, gated): try to propose viewing times right away. When it succeeds it
  // sends the renter interactive time-buttons itself, so the bot should NOT also offer a time.
  let scheduled = false
  if (viewingSchedulerEnabled()) {
    try {
      const r = await startViewingScheduling({
        orgId: ctx.orgId, renterId: ctx.renterId, propertyId: ctx.propertyId,
        renterThreadId: ctx.threadId, renterPhone: ctx.phone,
      })
      scheduled = r.ok
    } catch {/* fall back to the office path */}
  }

  return {
    ok: res.ok,
    recorded: res.recorded,
    scheduled,
    next: scheduled
      ? 'שלחתי לשוכר/ת מועדים אפשריים בכפתורים — בקש/י לבחור אחד מהם, ואל תציע/י מועד משלך'
      : 'tell the renter the office will reach out shortly to coordinate a viewing',
  }
}

async function notInterested(args: { reason?: string }, ctx: ReplyToolContext) {
  const sb = supabaseService()
  const { data: t } = await sb.from('threads').select('tags').eq('id', ctx.threadId).maybeSingle()
  const tags = (t?.tags && typeof t.tags === 'object') ? { ...(t.tags as Record<string, unknown>) } : {}
  tags.intent = 'not_interested'
  tags.intent_set_at = new Date().toISOString()
  await sb.from('threads').update({ tags }).eq('id', ctx.threadId)
  if (args.reason) {
    await sb.from('messages').insert({
      org_id: ctx.orgId, thread_id: ctx.threadId, property_id: ctx.propertyId,
      channel: 'whatsapp', direction: 'in', status: 'received', meta_message_type: 'note',
      body: `לא מעוניין/ת — ${args.reason}`.slice(0, 400),
      metadata: { kind: 'not_interested', renter_id: ctx.renterId, property_id: ctx.propertyId },
    })
  }
  return { ok: true }
}

function sendLink(ctx: ReplyToolContext) {
  if (!ctx.shareUrl) return { ok: false, note: 'no_share_link_available' }
  return { ok: true, url: ctx.shareUrl }
}

async function handoff(args: { reason: string }, ctx: ReplyToolContext) {
  const sb = supabaseService()
  await sb.from('threads').update({ status: 'human_takeover' }).eq('id', ctx.threadId)
  try {
    const { data: r } = await sb.from('renters').select('first_name').eq('id', ctx.renterId).maybeSingle()
    const base = (ctx.appBaseUrl || process.env.APP_BASE_URL || 'https://rent360-vert.vercel.app').replace(/\/$/, '')
    await notifyAdminsHandoff({
      threadId: ctx.threadId,
      landlordName: r?.first_name || 'שוכר',
      landlordPhone: ctx.phone,
      propertyTitle: ctx.propertyLabel || 'דירה',
      reason: args.reason || 'שוכר ביקש לדבר עם אדם',
      dashboardUrl: `${base}/inbox/${ctx.threadId}`,
    })
  } catch {/* best-effort */}
  return { ok: true, status: 'human_takeover' }
}

async function optOut(args: { reason?: string }, ctx: ReplyToolContext) {
  await recordOptOut({ orgId: ctx.orgId, phone: ctx.phone, source: 'ai_tool', reason: args.reason || 'renter asked to stop' })
  return { ok: true, status: 'opted_out' }
}
