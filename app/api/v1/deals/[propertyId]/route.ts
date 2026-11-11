import { NextRequest, NextResponse } from 'next/server'
import { requireOrg, capabilitiesOf } from '../../../../../lib/api/org-context'
import { normalizePhone } from '../../../../../lib/whatsapp/meta-provider'
import {
  isWorkStatus, RECRUIT_SOURCES, DOCS_STATUSES, PAYMENT_STATUSES, PAYMENT_METHODS,
} from '../../../../../lib/deals/model'

/**
 * Edit one deal row of the control board. Body = any subset of the fields below.
 *  - Everyone: status, handling agent (properties.assigned_agent_user_id), recruiter, source, dates,
 *    closing price, renter, docs status, note.
 *  - `commissions.manage` only: expected fee override and the payment fields. Marking payment as
 *    collected also updates the active tenancy, so /commissions and this board never disagree.
 */
const FORBIDDEN_PAYMENT = { error: { code: 'FORBIDDEN', message: 'רק הנהלה יכולה לעדכן נתוני תשלום' } }
const PAYMENT_FIELDS = ['expected_fee', 'payment_status', 'payment_method', 'invoice_number', 'collected_at'] as const

const bad = (message: string) => NextResponse.json({ error: { code: 'BAD_REQUEST', message } }, { status: 400 })
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const oneOf = (list: readonly { key: string }[], v: unknown) => typeof v === 'string' && list.some(i => i.key === v)
const nonNegInt = (v: unknown): number | null | undefined => {
  if (v === null || v === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 ? n : undefined
}
const text = (v: unknown, max = 500): string | null => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}

export async function PATCH(req: NextRequest, { params }: { params: { propertyId: string } }) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { sb, orgId, uid } = ctx
  const propertyId = params.propertyId

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* empty */ }

  const touchesPayment = PAYMENT_FIELDS.some(f => f in body)
  if (touchesPayment && !(await capabilitiesOf(ctx)).includes('commissions.manage')) {
    return NextResponse.json(FORBIDDEN_PAYMENT, { status: 403 })
  }

  const { data: prop } = await sb.from('properties').select('id').eq('id', propertyId).eq('org_id', orgId).maybeSingle()
  if (!prop) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })

  const { data: existing, error: readErr } = await sb.from('property_deals').select('work_status').eq('property_id', propertyId).maybeSingle()
  if (readErr) {
    const missing = /property_deals/.test(readErr.message)
    return NextResponse.json({ error: { code: missing ? 'MIGRATION_REQUIRED' : 'DB_ERROR', message: missing ? 'חסרה טבלת property_deals. יש להריץ את מיגרציה 0045.' : readErr.message } }, { status: missing ? 503 : 500 })
  }

  const patch: Record<string, unknown> = {}

  if ('work_status' in body) {
    if (!isWorkStatus(body.work_status)) return bad('סטטוס לא מוכר')
    patch.work_status = body.work_status
    if (body.work_status !== existing?.work_status) patch.status_changed_at = new Date().toISOString()
  }
  if ('recruit_source' in body) {
    if (body.recruit_source !== null && !oneOf(RECRUIT_SOURCES, body.recruit_source)) return bad('מקור גיוס לא מוכר')
    patch.recruit_source = body.recruit_source
  }
  if ('docs_status' in body) {
    if (!oneOf(DOCS_STATUSES, body.docs_status)) return bad('סטטוס מסמכים לא מוכר')
    patch.docs_status = body.docs_status
  }
  if ('payment_status' in body) {
    if (!oneOf(PAYMENT_STATUSES, body.payment_status)) return bad('סטטוס תשלום לא מוכר')
    patch.payment_status = body.payment_status
  }
  if ('payment_method' in body) {
    if (body.payment_method !== null && !oneOf(PAYMENT_METHODS, body.payment_method)) return bad('אמצעי תשלום לא מוכר')
    patch.payment_method = body.payment_method
  }
  for (const f of ['recruited_at', 'expected_close_date', 'signing_date', 'collected_at'] as const) {
    if (f in body) {
      if (body[f] !== null && body[f] !== '' && !isDate(body[f])) return bad('תאריך לא תקין')
      patch[f] = body[f] || null
    }
  }
  for (const f of ['closing_price', 'expected_fee'] as const) {
    if (f in body) {
      const n = nonNegInt(body[f])
      if (n === undefined) return bad('סכום חייב להיות מספר שלם, 0 ומעלה')
      patch[f] = n
    }
  }
  if ('deal_renter_name' in body) patch.deal_renter_name = text(body.deal_renter_name, 120)
  if ('deal_renter_phone' in body) {
    const raw = text(body.deal_renter_phone, 40)
    if (raw) {
      const phone = normalizePhone(raw)
      if (!/^\d{11,15}$/.test(phone)) return bad('מספר טלפון לא תקין')
      patch.deal_renter_phone = phone
    } else patch.deal_renter_phone = null
  }
  if ('invoice_number' in body) patch.invoice_number = text(body.invoice_number, 60)
  if ('note' in body) patch.note = text(body.note, 2000)

  // People: recruiter lives on the deal, the handling agent on the property card.
  const personIds: string[] = []
  if ('recruited_by_user_id' in body && body.recruited_by_user_id) personIds.push(String(body.recruited_by_user_id))
  if ('handler_user_id' in body && body.handler_user_id) personIds.push(String(body.handler_user_id))
  if (personIds.length) {
    const { data: found } = await sb.from('users').select('id').eq('org_id', orgId).in('id', personIds)
    if ((found || []).length !== new Set(personIds).size) return bad('המשתמש לא נמצא בארגון')
  }
  if ('recruited_by_user_id' in body) patch.recruited_by_user_id = body.recruited_by_user_id || null

  if ('payment_status' in patch && patch.payment_status === 'collected' && !patch.collected_at && !('collected_at' in body)) {
    patch.collected_at = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' })
  }
  if (patch.payment_status === 'pending' && !('collected_at' in body)) patch.collected_at = null

  const hasHandler = 'handler_user_id' in body
  if (Object.keys(patch).length === 0 && !hasHandler) return bad('אין שדות לעדכון')

  if (Object.keys(patch).length) {
    patch.updated_by = uid
    const { error } = existing
      ? await sb.from('property_deals').update(patch).eq('property_id', propertyId).eq('org_id', orgId)
      : await sb.from('property_deals').insert({ ...patch, property_id: propertyId, org_id: orgId })
    if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })
  }

  if (hasHandler) {
    const { error } = await sb.from('properties').update({ assigned_agent_user_id: body.handler_user_id || null }).eq('id', propertyId).eq('org_id', orgId)
    if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })
  }

  // Keep the tenancy's commission fields in step when payment was edited here.
  if ('payment_status' in patch) {
    const upd: Record<string, unknown> = { commission_status: patch.payment_status }
    upd.commission_collected_at = patch.payment_status === 'collected'
      ? (patch.collected_at ? new Date(`${patch.collected_at}T12:00:00+03:00`).toISOString() : new Date().toISOString())
      : null
    await sb.from('tenancies').update(upd).eq('org_id', orgId).eq('property_id', propertyId).eq('status', 'active')
  }

  return NextResponse.json({ ok: true })
}
