import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../../lib/supabase'
import { normalizePhone } from '../../../../../../lib/outreach/phone'
import { notifyAdminsRenterInterest } from '../../../../../../lib/alerts/admin-whatsapp'
import { sendGmail } from '../../../../../../lib/google/gmail'

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
    .select('city, neighborhood, street, price, rooms, assigned_agent_user_id')
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
    .select('phone, first_name, last_name, budget_min, budget_max, preferred_rooms, move_in_date, household_size, notes')
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
      renterId: share.renter_id,
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

  // Email the property's ASSIGNED AGENT with the renter's details (sent from any connected staff
  // account). Fail-soft: skipped if no agent / no email / no connected sender.
  try {
    if (prop?.assigned_agent_user_id) {
      const { data: agent } = await sb.from('users').select('email, name').eq('id', prop.assigned_agent_user_id).eq('org_id', share.org_id).maybeSingle()
      const { data: sender } = await sb.from('google_connections').select('user_id').eq('org_id', share.org_id).eq('status', 'active').limit(1).maybeSingle()
      if (agent?.email && sender?.user_id) {
        const fullName = [renter.first_name, renter.last_name].filter(Boolean).join(' ') || 'שוכר'
        const budget = renter.budget_min || renter.budget_max
          ? `${renter.budget_min ? `₪${Number(renter.budget_min).toLocaleString('he-IL')}` : ''}${renter.budget_max ? `–₪${Number(renter.budget_max).toLocaleString('he-IL')}` : ''}`
          : '—'
        const lines = [
          `שוכר/ת מעוניין/ת לראות את הנכס: ${location || '—'}`,
          prop.price != null ? `מחיר: ₪${Number(prop.price).toLocaleString('he-IL')}` : '',
          score ? `התאמה: ${score}%` : '',
          '',
          'פרטי השוכר/ת:',
          `שם: ${fullName}`,
          `טלפון: ${renter.phone}`,
          `תקציב: ${budget}`,
          renter.preferred_rooms != null ? `חדרים מבוקשים: ${renter.preferred_rooms}` : '',
          renter.household_size != null ? `גודל משק בית: ${renter.household_size}` : '',
          renter.move_in_date ? `כניסה: ${renter.move_in_date}` : '',
          renter.notes ? `הערות: ${renter.notes}` : '',
          '',
          `${(process.env.APP_BASE_URL || '').replace(/\/$/, '')}/renters/${share.renter_id}`,
        ].filter(Boolean)
        await sendGmail({
          orgId: share.org_id, userId: sender.user_id, to: agent.email,
          subject: `מעוניין/ת לראות דירה — ${location || 'נכס'}`, text: lines.join('\n'),
        })
      }
    }
  } catch {
    // best-effort — email failures never block recording the interest
  }

  return NextResponse.json({ ok: true, recorded: true })
}
