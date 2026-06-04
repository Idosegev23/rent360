import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../../lib/supabase'
import { normalizePhone } from '../../../../../../lib/outreach/phone'
import { notifyAdminsRenterInterest } from '../../../../../../lib/alerts/admin-whatsapp'

/**
 * Public: a renter clicked "מעוניין/ת לראות את הדירה" on their /share link.
 *
 * Records the interest so it surfaces in the admin inbox: we drop an inbound
 * message on the renter's thread and flag it for human attention. The token
 * (renter-linked share) tells us which renter + property. No auth — the renter
 * arrives from a WhatsApp link. Allowlisted in middleware via /api/v1/shares/.
 */
export async function POST(_req: NextRequest, { params }: { params: { token: string } }) {
  const sb = supabaseService()

  const { data: share } = await sb
    .from('property_shares')
    .select('org_id, property_id, renter_id, match_id')
    .eq('token', params.token)
    .maybeSingle()
  if (!share) return NextResponse.json({ error: { code: 'SHARE_NOT_FOUND' } }, { status: 404 })

  // Property label for the inbox preview + the admin alert.
  const { data: prop } = await sb
    .from('properties')
    .select('city, neighborhood, street, price, rooms')
    .eq('id', share.property_id)
    .maybeSingle()
  // Specific address (street + clean city) so the admin knows exactly which apartment.
  const cityClean = (prop?.city || '').replace(/\s*-\s*(מגורים|משרדים|rent).*$/i, '').trim()
  const location = prop
    ? ([prop.street, cityClean].filter(Boolean).join(', ') || cityClean || prop.street || '')
    : ''

  // No renter attribution (generic property share) — acknowledge without recording.
  if (!share.renter_id) return NextResponse.json({ ok: true, recorded: false })

  const { data: renter } = await sb
    .from('renters')
    .select('phone, first_name')
    .eq('id', share.renter_id)
    .maybeSingle()
  if (!renter?.phone) return NextResponse.json({ ok: true, recorded: false })

  const phone = normalizePhone(renter.phone)

  // Find or create the renter's thread.
  const { data: existing } = await sb
    .from('threads')
    .select('id, tags')
    .eq('org_id', share.org_id)
    .eq('phone', phone)
    .maybeSingle()

  let threadId = existing?.id
  let tags: Record<string, unknown> = (existing?.tags && typeof existing.tags === 'object')
    ? existing.tags as Record<string, unknown>
    : { audience: 'renter', renter_id: share.renter_id, ...(renter.first_name ? { renter_name: renter.first_name } : {}) }

  if (!threadId) {
    const { data: created } = await sb
      .from('threads')
      .insert({ org_id: share.org_id, phone, channel: 'whatsapp', status: 'human_takeover', property_id: share.property_id, tags })
      .select('id')
      .single()
    threadId = created?.id
  }
  if (!threadId) return NextResponse.json({ error: { code: 'THREAD_FAILED' } }, { status: 500 })

  const now = new Date().toISOString()
  await sb.from('messages').insert({
    org_id: share.org_id,
    thread_id: threadId,
    property_id: share.property_id,
    channel: 'whatsapp',
    direction: 'in',
    status: 'received',
    meta_message_type: 'interest',
    body: location ? `מעוניין/ת לראות את הדירה — ${location}` : 'מעוניין/ת לראות את הדירה',
    metadata: { kind: 'interest', renter_id: share.renter_id, property_id: share.property_id },
  })

  await sb
    .from('threads')
    .update({ status: 'human_takeover', last_inbound_at: now, last_message_at: now, tags: { ...tags, interested: true }, property_id: share.property_id })
    .eq('id', threadId)

  // Admin WhatsApp alert to Ziv (fail-soft — needs ADMIN_ALERT_PHONES + approved template).
  let score = ''
  if (share.match_id) {
    const { data: m } = await sb.from('matches').select('score').eq('id', share.match_id).maybeSingle()
    if (m?.score != null) score = String(Math.round(Number(m.score)))
  }
  try {
    await notifyAdminsRenterInterest({
      renterName: renter.first_name || 'שוכר',
      renterPhone: renter.phone,
      propertyLocation: location,
      price: prop?.price != null ? Number(prop.price).toLocaleString('en-US') : '',
      rooms: prop?.rooms != null ? String(prop.rooms) : '',
      score,
    })
  } catch {
    // best-effort
  }

  return NextResponse.json({ ok: true, recorded: true })
}
