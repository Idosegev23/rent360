/**
 * Dispatch the `admin_handoff_alert_v1` Meta template to every phone in
 * ADMIN_ALERT_PHONES when the AI agent triggers a handoff (or, in the
 * future, a closed_won / urgent event).
 *
 * Silent no-op when ADMIN_ALERT_PHONES is empty so dev environments don't
 * spam real admins.
 */

import { sendTemplate } from '../whatsapp/meta-provider'
import { parsePhoneList } from '../outreach/phone'
import { supabaseService } from '../supabase'

// Handoff alert template. v2 fixes the button URL to the working production domain
// (rent360-vert.vercel.app/inbox/{{1}}); v1's button pointed at the dead rent360admin
// domain (404/401). Env-overridable so we can flip to v2 the moment Meta approves it.
const ADMIN_HANDOFF_TEMPLATE = process.env.ADMIN_HANDOFF_TEMPLATE || 'admin_handoff_alert_v1'

export type AdminHandoffPayload = {
  threadId: string
  landlordName: string
  landlordPhone: string
  propertyTitle: string
  reason: string
  dashboardUrl: string
}

export type AdminAlertResult = {
  attempted: number
  sent: number
  failed: number
  errors: Array<{ phone: string; error: string }>
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}

export async function notifyAdminsHandoff(payload: AdminHandoffPayload): Promise<AdminAlertResult> {
  const admins = parsePhoneList(process.env.ADMIN_ALERT_PHONES)
  if (admins.length === 0) {
    return { attempted: 0, sent: 0, failed: 0, errors: [] }
  }

  // Meta template params have practical length limits (~60 chars) — truncate to keep templates valid.
  const landlordName = truncate(payload.landlordName || 'לקוח', 40)
  const landlordPhone = truncate(payload.landlordPhone, 20)
  const propertyTitle = truncate(payload.propertyTitle || 'נכס', 50)
  const reason = truncate(payload.reason || 'בקשה לאדם', 60)

  const components = [
    {
      type: 'body' as const,
      parameters: [
        { type: 'text' as const, text: landlordName },
        { type: 'text' as const, text: landlordPhone },
        { type: 'text' as const, text: propertyTitle },
        { type: 'text' as const, text: reason },
      ],
    },
    {
      type: 'button' as const,
      sub_type: 'url' as const,
      index: 0,
      parameters: [
        { type: 'text' as const, text: payload.threadId },
      ],
    },
  ]

  const result: AdminAlertResult = { attempted: admins.length, sent: 0, failed: 0, errors: [] }
  const sb = supabaseService()
  // Find the org id for audit logging (single tenant for now).
  const { data: org } = await sb.from('organizations').select('id').limit(1).single()
  const orgId = org?.id

  for (const phone of admins) {
    try {
      const r = await sendTemplate({
        to: phone,
        name: ADMIN_HANDOFF_TEMPLATE,
        language: 'he',
        components,
      })
      result.sent++

      // Audit row — write into a "shared" admin alerts thread per admin phone.
      if (orgId) {
        const adminThread = await upsertAdminThread(orgId, phone)
        if (adminThread?.id) {
          await sb.from('messages').insert({
            org_id: orgId,
            thread_id: adminThread.id,
            channel: 'whatsapp',
            direction: 'out',
            body: null,
            status: 'sent',
            external_id: r.messageId,
            meta_message_type: 'template',
            template_name: ADMIN_HANDOFF_TEMPLATE,
            template_params: { admin_phone: phone, ...payload },
            metadata: { admin_alert: true },
          })
        }
      }
    } catch (err) {
      result.failed++
      result.errors.push({ phone, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return result
}

export type RenterInterestPayload = {
  renterName: string
  renterPhone: string
  propertyLocation: string
  price: string
  rooms: string
  score: string
}

/**
 * Notify admins (ADMIN_ALERT_PHONES) that a renter clicked "interested in viewing"
 * on their /share link — via the `renter_interest_alert_v1` template. No-op when the
 * env is empty; throws nothing (errors collected). Will fail-soft until Meta approves
 * the template.
 */
export async function notifyAdminsRenterInterest(payload: RenterInterestPayload): Promise<AdminAlertResult> {
  const admins = parsePhoneList(process.env.ADMIN_ALERT_PHONES)
  if (admins.length === 0) return { attempted: 0, sent: 0, failed: 0, errors: [] }

  const components = [
    {
      type: 'body' as const,
      parameters: [
        { type: 'text' as const, text: truncate(payload.renterName || 'שוכר', 40) },
        { type: 'text' as const, text: truncate(payload.renterPhone || '-', 20) },
        { type: 'text' as const, text: truncate(payload.propertyLocation || 'דירה', 50) },
        { type: 'text' as const, text: truncate(payload.price || '-', 15) },
        { type: 'text' as const, text: truncate(payload.rooms || '-', 8) },
        { type: 'text' as const, text: truncate(payload.score || '-', 5) },
      ],
    },
  ]

  const result: AdminAlertResult = { attempted: admins.length, sent: 0, failed: 0, errors: [] }
  for (const phone of admins) {
    try {
      await sendTemplate({ to: phone, name: 'renter_interest_alert_v1', language: 'he', components })
      result.sent++
    } catch (err) {
      result.failed++
      result.errors.push({ phone, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return result
}

async function upsertAdminThread(orgId: string, phone: string): Promise<{ id: string } | null> {
  const sb = supabaseService()
  const { data: existing } = await sb
    .from('threads')
    .select('id')
    .eq('org_id', orgId)
    .eq('phone', phone)
    .maybeSingle()
  if (existing) return existing
  const { data: created } = await sb
    .from('threads')
    .insert({ org_id: orgId, phone, channel: 'whatsapp', status: 'admin_alerts', tags: { kind: 'admin_alerts' } })
    .select('id')
    .single()
  return created || null
}
