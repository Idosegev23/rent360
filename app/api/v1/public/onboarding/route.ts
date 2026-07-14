import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { sendTemplate, normalizePhone } from '../../../../../lib/whatsapp/meta-provider'
import { isSuppressed } from '../../../../../lib/outreach/suppression'
import { sendTelegramAlert } from '../../../../../lib/alerts/telegram'

/**
 * PUBLIC onboarding from the /join Facebook forms. Two audiences:
 *  - renter   → upsert renters(by phone, source='facebook') + fire the intake bot opener.
 *  - landlord → create a properties lead (source='facebook_onboarding', is_active=false) for the
 *               "אשר תיווך" queue + a best-effort Telegram admin ping.
 * Every submission is recorded in onboarding_submissions (audit + dedupe + rate limit).
 *
 * No auth. Abuse guards: honeypot, required-field + phone validation, per-phone hourly rate limit.
 * Allowlisted in middleware. Keeps the demo fallback ({status:'demo'}) when there's no org yet.
 */
const INTAKE_TEMPLATE = process.env.RENTER_INTAKE_TEMPLATE || 'renter_intake_invite_v1'
const RATE_LIMIT_PER_HOUR = 5

const clean = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max)
const toInt = (v: unknown): number | null => { const n = parseInt(String(v ?? ''), 10); return Number.isFinite(n) ? n : null }
const bad = (message: string) => NextResponse.json({ error: { code: 'BAD_REQUEST', message } }, { status: 400 })

export async function POST(req: NextRequest) {
  let body: Record<string, any> = {}
  try { body = await req.json() } catch {/* empty */}

  // Honeypot — bots fill hidden fields. Pretend success, write nothing.
  if (clean(body.company) || clean(body.website) || clean(body.hp)) {
    return NextResponse.json({ ok: true, audience: clean(body.audience) || 'renter' })
  }

  const audience = clean(body.audience)
  if (audience !== 'renter' && audience !== 'landlord') return bad('audience must be renter or landlord')

  const name = clean(body.name, 80)
  const phoneRaw = clean(body.phone, 40)
  if (!name) return bad('name required')
  if (!phoneRaw) return bad('phone required')
  const phone = normalizePhone(phoneRaw)
  if (!/^972\d{8,9}$/.test(phone)) return bad('invalid phone')

  const sb = supabaseService()
  const { data: org } = await sb.from('organizations').select('id').order('created_at').limit(1).maybeSingle()
  const orgId = org?.id
  // Preserve the "demo" fallback other public POSTs use when the backend isn't configured.
  if (!orgId) return NextResponse.json({ status: 'demo', accepted: true })

  // Per-phone hourly rate limit.
  const sinceHour = new Date(Date.now() - 3600_000).toISOString()
  const { count } = await sb.from('onboarding_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('contact_phone', phone).gte('created_at', sinceHour)
  if ((count || 0) >= RATE_LIMIT_PER_HOUR) {
    return NextResponse.json({ error: { code: 'RATE_LIMITED' } }, { status: 429 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const userAgent = req.headers.get('user-agent')?.slice(0, 300) || null
  const city = clean(body.city, 80) || null

  if (audience === 'renter') {
    return handleRenter(sb, orgId, { name, phone, city, budget: toInt(body.budget), ip, userAgent, payload: body })
  }
  return handleLandlord(sb, orgId, {
    name, phone, city, address: clean(body.address, 200) || null, price: toInt(body.price),
    note: clean(body.note, 500) || null, ip, userAgent, payload: body,
  })
}

type RenterInput = { name: string; phone: string; city: string | null; budget: number | null; ip: string | null; userAgent: string | null; payload: unknown }
async function handleRenter(sb: ReturnType<typeof supabaseService>, orgId: string, p: RenterInput) {
  // Upsert renter by phone (renters is org-agnostic/global, like the web-form path).
  const { data: existing } = await sb.from('renters').select('id, first_name, source').eq('phone', p.phone).maybeSingle()
  let renterId: string
  if (existing) {
    renterId = existing.id
    const upd: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (!existing.first_name && p.name) upd.first_name = p.name
    if (!existing.source) upd.source = 'facebook'
    if (p.budget != null) upd.budget_max = p.budget
    await sb.from('renters').update(upd).eq('id', renterId)
  } else {
    const insertRow: Record<string, unknown> = { phone: p.phone, first_name: p.name, source: 'facebook' }
    if (p.budget != null) insertRow.budget_max = p.budget
    if (p.city) insertRow.preferred_cities = [p.city]
    const { data: ins, error } = await sb.from('renters').insert(insertRow).select('id').single()
    if (error || !ins) return NextResponse.json({ error: { code: 'CREATE_FAILED', message: error?.message } }, { status: 500 })
    renterId = ins.id
  }

  await sb.from('onboarding_submissions').insert({
    org_id: orgId, audience: 'renter', payload: p.payload, contact_name: p.name, contact_phone: p.phone,
    city: p.city, created_renter_id: renterId, ip: p.ip, user_agent: p.userAgent, status: 'processed',
  })

  let opener = 'skipped'
  try { opener = await sendIntakeOpener(sb, orgId, renterId, p.phone, p.name) } catch { opener = 'error' }

  return NextResponse.json({ ok: true, audience: 'renter', renterId, opener })
}

type LandlordInput = { name: string; phone: string; city: string | null; address: string | null; price: number | null; note: string | null; ip: string | null; userAgent: string | null; payload: unknown }
async function handleLandlord(sb: ReturnType<typeof supabaseService>, orgId: string, p: LandlordInput) {
  const title = [p.address, p.city].filter(Boolean).join(', ') || p.city || 'ליד מפייסבוק'

  // Dedupe an identical phone landlord submission within the last hour.
  const sinceHour = new Date(Date.now() - 3600_000).toISOString()
  const { data: recent } = await sb.from('onboarding_submissions')
    .select('created_property_id').eq('audience', 'landlord').eq('contact_phone', p.phone)
    .gte('created_at', sinceHour).not('created_property_id', 'is', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  let propertyId: string | null = recent?.created_property_id || null

  if (!propertyId) {
    const insertRow: Record<string, unknown> = {
      org_id: orgId, title, city: p.city || 'לא צוין', address: p.address,
      contact_name: p.name, contact_phone: p.phone, source: 'facebook_onboarding', is_active: false,
    }
    if (p.price != null) insertRow.price = p.price
    const { data: ins, error } = await sb.from('properties').insert(insertRow).select('id').single()
    if (error || !ins) return NextResponse.json({ error: { code: 'CREATE_FAILED', message: error?.message } }, { status: 500 })
    propertyId = ins.id
  }

  await sb.from('onboarding_submissions').insert({
    org_id: orgId, audience: 'landlord', payload: p.payload, contact_name: p.name, contact_phone: p.phone,
    city: p.city, created_property_id: propertyId, ip: p.ip, user_agent: p.userAgent, status: 'processed',
  })

  try {
    await sendTelegramAlert({
      threadId: '', type: 'new_lead', landlordName: p.name, landlordPhone: p.phone,
      propertyTitle: title, reason: 'ליד חדש מפייסבוק (בעל דירה)',
      ...(p.note ? { notes: p.note } : {}),
    })
  } catch {/* best-effort */}

  return NextResponse.json({ ok: true, audience: 'landlord', propertyId })
}

async function sendIntakeOpener(sb: ReturnType<typeof supabaseService>, orgId: string, renterId: string, phone: string, firstName: string): Promise<string> {
  const { data: tpl } = await sb.from('whatsapp_templates').select('status').eq('name', INTAKE_TEMPLATE).maybeSingle()
  if (!tpl || tpl.status !== 'approved') return 'template_not_approved'
  if (await isSuppressed(orgId, phone)) return 'suppressed'

  const components = [{ type: 'body' as const, parameters: [{ type: 'text' as const, text: (firstName || 'שלום').slice(0, 40) }] }]
  const r = await sendTemplate({ to: phone, name: INTAKE_TEMPLATE, language: 'he', components })

  const thread = await upsertRenterThread(sb, orgId, phone, renterId, firstName)
  if (thread?.id) {
    await sb.from('messages').insert({
      org_id: orgId, thread_id: thread.id, channel: 'whatsapp', direction: 'out', body: null,
      status: 'sent', external_id: r.messageId, meta_message_type: 'template', template_name: INTAKE_TEMPLATE,
      template_params: { first_name: firstName, via: 'facebook_onboarding' },
    })
    await sb.from('threads').update({ last_outbound_at: new Date().toISOString(), last_message_at: new Date().toISOString() }).eq('id', thread.id)
  }
  return 'sent'
}

async function upsertRenterThread(sb: ReturnType<typeof supabaseService>, orgId: string, phone: string, renterId: string, firstName?: string | null): Promise<{ id: string } | null> {
  const { data: existing } = await sb.from('threads').select('id').eq('org_id', orgId).eq('phone', phone).maybeSingle()
  if (existing) return existing as { id: string }
  const { data: created } = await sb.from('threads').insert({
    org_id: orgId, phone, channel: 'whatsapp', status: 'awaiting_reply',
    tags: { audience: 'renter', renter_id: renterId, source: 'facebook_onboarding', ...(firstName ? { renter_name: firstName } : {}) },
  }).select('id').single()
  return created || null
}
