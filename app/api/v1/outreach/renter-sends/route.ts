import { NextResponse } from 'next/server'
import { requireOrg } from '@/lib/api/org-context'

export const dynamic = 'force-dynamic'

/**
 * Log of renter match-alert sends: every WhatsApp template we sent a renter, newest first —
 * who sent it (staff name, from message metadata.sent_by), when, which renter + property.
 * Covers historical sends too (matched by template name), even before sender attribution existed.
 */
export async function GET() {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const { data: rows } = await ctx.sb
    .from('messages')
    .select('id, created_at, template_params, metadata, property_id, thread_id')
    .eq('org_id', ctx.orgId)
    .eq('meta_message_type', 'template')
    .in('template_name', ['renter_match_alert_v1', 'renter_match_alert_v2'])
    .order('created_at', { ascending: false })
    .limit(200)
  const list = rows || []

  const senderIds = Array.from(new Set(list.map((r) => (r.metadata as any)?.sent_by).filter(Boolean))) as string[]
  const names = new Map<string, string>()
  if (senderIds.length) {
    const { data: users } = await ctx.sb.from('users').select('id, name').in('id', senderIds)
    for (const u of users || []) names.set(u.id, u.name || '')
  }

  const sends = list.map((r) => {
    const tp = (r.template_params || {}) as any
    const sentBy = (r.metadata as any)?.sent_by as string | null
    return {
      id: r.id,
      sent_at: r.created_at,
      renter_name: tp.first_name || 'שוכר',
      renter_id: tp.renter_id || null,
      property_label: tp.location || null,
      property_id: r.property_id || tp.property_id || null,
      sent_by_name: sentBy ? names.get(sentBy) || 'צוות' : 'מערכת',
      thread_id: r.thread_id,
    }
  })
  return NextResponse.json({ sends })
}
