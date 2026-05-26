import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseService } from '../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../lib/auth'
import { normalizePhone } from '../../../../../lib/whatsapp/meta-provider'
import { embedInBackground, embedPropertyIfChanged } from '../../../../../lib/ai/embeddings'
import { improveTextOrFallback } from '../../../../../lib/ai/text-improve'
import { generatePersonalizationInBackground } from '../../../../../lib/ai/property-vision'
import { computeMatchesInBackground } from '../../../../../lib/matching/orchestrator'

/**
 * Employee-facing endpoint to manually add a property the company has already
 * agreed to broker. Creates the property row and (by default) immediately
 * inserts an `approved_properties` row with `approval_method='manual'`.
 *
 * Caller pre-uploads images via the browser to `property-images/<propertyId>/...`
 * and passes the resulting public URLs as `images: string[]`. The propertyId
 * the client used MUST be sent back as `propertyId` so we insert with the same
 * UUID (otherwise the images live under a folder that doesn't match the row).
 */
export async function POST(req: NextRequest) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id, name').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })
  const orgId = user.org_id

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: { code: 'BAD_JSON' } }, { status: 400 })
  }

  const required = ['propertyId', 'contact_name', 'contact_phone', 'city', 'price']
  const missing = required.filter(k => !body[k] || (typeof body[k] === 'string' && !body[k].trim()))
  if (missing.length) {
    return NextResponse.json({
      error: { code: 'MISSING_FIELDS', message: `חסרים שדות חובה: ${missing.join(', ')}` },
    }, { status: 422 })
  }

  const propertyId = String(body.propertyId).trim()
  if (!/^[a-f0-9-]{36}$/i.test(propertyId)) {
    return NextResponse.json({ error: { code: 'BAD_PROPERTY_ID', message: 'propertyId חייב להיות UUID' } }, { status: 422 })
  }

  const phone = normalizePhone(String(body.contact_phone))
  if (!/^\d{11,15}$/.test(phone)) {
    return NextResponse.json({ error: { code: 'BAD_PHONE', message: 'מספר טלפון לא תקין' } }, { status: 422 })
  }

  // Auto-improve description before insert (employees often paste messy text).
  // Fails open: if OpenAI is down, the raw text is kept and `improved=false`
  // is returned so the UI can show a toast.
  const rawDescription = body.description ? String(body.description).trim() : ''
  const skipImprove = body.skip_ai_improve === true
  const improveResult = (!skipImprove && rawDescription)
    ? await improveTextOrFallback(rawDescription, 'description')
    : { text: rawDescription, improved: false }
  const finalDescription = improveResult.text || null

  // Build property payload — every field is optional except the required ones above.
  const now = new Date().toISOString()
  const propertyRow: Record<string, unknown> = {
    id: propertyId,
    org_id: orgId,
    title: String(body.title || `${body.contact_name} - ${body.city}`).slice(0, 200),
    city: String(body.city).trim(),
    neighborhood: body.neighborhood ? String(body.neighborhood).trim() : null,
    street: body.street ? String(body.street).trim() : null,
    address: body.address ? String(body.address).trim() : null,
    price: Number(body.price),
    rooms: body.rooms !== undefined && body.rooms !== '' && body.rooms !== null ? Number(body.rooms) : null,
    sqm: body.sqm !== undefined && body.sqm !== '' && body.sqm !== null ? Number(body.sqm) : null,
    floor: body.floor !== undefined && body.floor !== '' && body.floor !== null ? Number(body.floor) : null,
    contact_name: String(body.contact_name).trim(),
    contact_phone: phone,
    description: finalDescription,
    full_text: rawDescription || null,
    available_from: body.available_from || null,
    evacuation_date: body.evacuation_date || body.available_from || null,
    amenities: typeof body.amenities === 'object' && body.amenities ? body.amenities : {},
    images: Array.isArray(body.images) ? body.images.filter((u: unknown) => typeof u === 'string' && u.length > 0) : [],
    pets_allowed: typeof body.pets_allowed === 'boolean' ? body.pets_allowed : null,
    smokers_allowed: typeof body.smokers_allowed === 'boolean' ? body.smokers_allowed : null,
    source: 'manual_employee',
    is_active: true,
    initial_message_sent: false,
    outreach_blocked: false,
    created_at: now,
    updated_at: now,
  }

  // Strip null/undefined to let DB defaults take effect where applicable
  for (const k of Object.keys(propertyRow)) {
    if (propertyRow[k] === null || propertyRow[k] === undefined) delete propertyRow[k]
  }

  const { data: inserted, error: insertErr } = await sb
    .from('properties')
    .insert(propertyRow)
    .select('id')
    .single()
  if (insertErr) {
    return NextResponse.json({
      error: { code: 'INSERT_FAILED', message: insertErr.message },
    }, { status: 500 })
  }

  // Auto-approve by default (employee-added properties are agreed brokerages)
  const autoApprove = body.auto_approve !== false
  if (autoApprove) {
    const { error: approveErr } = await sb.from('approved_properties').insert({
      org_id: orgId,
      property_id: inserted.id,
      approved_by: userId,
      approval_method: 'manual',
    })
    if (approveErr && approveErr.code !== '23505') {
      // 23505 = unique violation. Anything else is unexpected.
      console.error('[manual-add] approve insert failed:', approveErr.message)
    }
  }

  // Embedding + personalization-line fire ONLY when the property is auto-approved.
  // Unapproved properties stay out of the RAG index AND don't generate vision
  // observations (those are for outreach we never send to them).
  if (autoApprove) {
    embedInBackground(() => embedPropertyIfChanged(inserted.id), `manual-add:${inserted.id}`)
    generatePersonalizationInBackground(inserted.id)
    computeMatchesInBackground({ propertyId: inserted.id })
  }

  return NextResponse.json({
    ok: true,
    property_id: inserted.id,
    approved: autoApprove,
    description_improved: improveResult.improved,
  })
}
