import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserIdFromSupabaseCookie } from '../../../../lib/auth'
import { supabaseService } from '../../../../lib/supabase'

/**
 * Tenancies = closed deals (a renter who actually rented a property through us).
 *
 * GET ?propertyId=… → candidate renters to link (the ones we matched/shared for that property)
 * GET ?renterId=…   → candidate properties to link (the ones matched for that renter)
 * GET (no params)   → list active tenancies (with renter+property labels)
 * POST { renter_id, property_id, started_at?, monthly_rent? } → create the tenancy + take the
 *      property off-market (is_active=false, outreach_blocked=true).
 */
async function org(): Promise<{ sb: ReturnType<typeof supabaseService>; orgId: string; uid: string } | null> {
  const token = cookies().get('sb-access-token')?.value
  const uid = getUserIdFromSupabaseCookie(token)
  if (!uid) return null
  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', uid).maybeSingle()
  if (!user) return null
  return { sb, orgId: user.org_id, uid }
}

const renterName = (r: any) => [r?.first_name, r?.last_name].filter(Boolean).join(' ') || 'ללא שם'
const propLabel = (p: any) => {
  const city = (p?.city || '').replace(/\s*-\s*(מגורים|משרדים).*$/, '').trim()
  return [p?.street || p?.address, city].filter(Boolean).join(', ') || p?.title || 'נכס'
}

export async function GET(req: NextRequest) {
  const ctx = await org()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { sb, orgId } = ctx
  const url = new URL(req.url)
  const propertyId = url.searchParams.get('propertyId')
  const renterId = url.searchParams.get('renterId')

  if (propertyId) {
    // candidate renters = matched (non-DQ) for this property, best first
    const { data: matches } = await sb
      .from('matches').select('renter_id, score, is_disqualified')
      .eq('org_id', orgId).eq('property_id', propertyId).eq('is_disqualified', false)
      .order('score', { ascending: false }).limit(40)
    const ids = Array.from(new Set((matches || []).map(m => (m as any).renter_id))).filter(Boolean)
    const scoreById = new Map((matches || []).map(m => [(m as any).renter_id, Number((m as any).score) || 0]))
    let renters: any[] = []
    if (ids.length) {
      const { data } = await sb.from('renters').select('id, first_name, last_name, phone').in('id', ids)
      renters = (data || []).map(r => ({ id: r.id, name: renterName(r), phone: r.phone, score: scoreById.get(r.id) ?? null }))
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    }
    const { data: existing } = await sb.from('tenancies').select('id, renter_id, status').eq('property_id', propertyId).eq('status', 'active').maybeSingle()
    return NextResponse.json({ renters, existing: existing || null })
  }

  if (renterId) {
    const { data: matches } = await sb
      .from('matches').select('property_id, score, is_disqualified')
      .eq('org_id', orgId).eq('renter_id', renterId).eq('is_disqualified', false)
      .order('score', { ascending: false }).limit(40)
    const ids = Array.from(new Set((matches || []).map(m => (m as any).property_id))).filter(Boolean)
    const scoreById = new Map((matches || []).map(m => [(m as any).property_id, Number((m as any).score) || 0]))
    let properties: any[] = []
    if (ids.length) {
      const { data } = await sb.from('properties').select('id, title, city, street, address, price').in('id', ids).eq('org_id', orgId)
      properties = (data || []).map(p => ({ id: p.id, label: propLabel(p), price: p.price, score: scoreById.get(p.id) ?? null }))
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    }
    return NextResponse.json({ properties })
  }

  // list active tenancies
  const { data: tenancies } = await sb.from('tenancies').select('*').eq('org_id', orgId).eq('status', 'active').order('created_at', { ascending: false }).limit(200)
  return NextResponse.json({ tenancies: tenancies || [] })
}

export async function POST(req: NextRequest) {
  const ctx = await org()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { sb, orgId, uid } = ctx

  let body: any = {}
  try { body = await req.json() } catch {/* empty */}
  const renter_id = String(body.renter_id || '')
  const property_id = String(body.property_id || '')
  if (!renter_id || !property_id) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'renter_id + property_id required' } }, { status: 400 })

  // Verify the property belongs to the org + the renter exists.
  const { data: prop } = await sb.from('properties').select('id').eq('id', property_id).eq('org_id', orgId).maybeSingle()
  if (!prop) return NextResponse.json({ error: { code: 'PROPERTY_NOT_FOUND' } }, { status: 404 })
  const { data: renter } = await sb.from('renters').select('id').eq('id', renter_id).maybeSingle()
  if (!renter) return NextResponse.json({ error: { code: 'RENTER_NOT_FOUND' } }, { status: 404 })

  // optional match link
  const { data: m } = await sb.from('matches').select('id').eq('org_id', orgId).eq('property_id', property_id).eq('renter_id', renter_id).maybeSingle()

  const started_at = typeof body.started_at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(body.started_at) ? body.started_at : null
  const monthly_rent = Number.isFinite(Number(body.monthly_rent)) && Number(body.monthly_rent) > 0 ? Math.round(Number(body.monthly_rent)) : null

  // If there's already an active tenancy for this property, update it (re-link) instead of erroring.
  const { data: existing } = await sb.from('tenancies').select('id').eq('property_id', property_id).eq('status', 'active').maybeSingle()
  let tenancyId = existing?.id
  if (existing) {
    await sb.from('tenancies').update({ renter_id, match_id: m?.id || null, started_at, monthly_rent, updated_at: new Date().toISOString() }).eq('id', existing.id)
  } else {
    const { data: created, error } = await sb.from('tenancies').insert({
      org_id: orgId, renter_id, property_id, match_id: m?.id || null, started_at, monthly_rent,
      commission_amount: monthly_rent ?? null, status: 'active', created_by: uid,
    }).select('id').single()
    if (error) return NextResponse.json({ error: { code: 'INSERT_FAILED', message: error.message } }, { status: 500 })
    tenancyId = created?.id
  }

  // Rented → take it off-market + stop outreach for it.
  await sb.from('properties').update({ is_active: false, outreach_blocked: true }).eq('id', property_id).eq('org_id', orgId)

  return NextResponse.json({ ok: true, id: tenancyId })
}
