import { NextRequest, NextResponse } from 'next/server'
import { PropertyInput } from './types'
import { getOrgIdFromAuthHeader, getUserIdFromSupabaseCookie } from '../../../../lib/auth'
import { supabaseService } from '../../../../lib/supabase'
import { cookies } from 'next/headers'

export async function POST(req: NextRequest){
  const idem = req.headers.get('idempotency-key')
  const auth = req.headers.get('authorization')
  if(!idem) return NextResponse.json({ error: { code: 'NO_IDEMPOTENCY' } }, { status: 409 })
  if(!auth) return NextResponse.json({ error: { code: 'NO_AUTH' } }, { status: 401 })

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON' } }, { status: 422 })
  }

  const parsed = PropertyInput.safeParse(json)
  if(!parsed.success){
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', issues: parsed.error.flatten() } }, { status: 422 })
  }

  const orgId = getOrgIdFromAuthHeader(auth)
  if(!orgId){
    return NextResponse.json({ error: { code: 'NO_ORG_IN_JWT' } }, { status: 401 })
  }

  if(!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE){
    return NextResponse.json({ status: 'demo', accepted: true, org_id: orgId }, { status: 201 })
  }

  const sb = supabaseService()

  const { data: prev } = await sb
    .from('inbound_events')
    .select('id, status')
    .eq('org_id', orgId)
    .eq('idempotency_key', idem)
    .order('created_at', { ascending: false })
    .limit(1)
  if(prev && prev.length > 0){
    return NextResponse.json({ status: 'duplicate' }, { status: 200 })
  }

  await sb.from('inbound_events').insert({
    org_id: orgId,
    source_id: parsed.data.source_id,
    endpoint: 'POST /properties',
    payload: json as any,
    status: 'received',
    idempotency_key: idem,
  })

  const upsertPayload = {
    org_id: orgId,
    external_id: parsed.data.external_id ?? null,
    source_id: parsed.data.source_id,
    title: parsed.data.title,
    city: parsed.data.city,
    neighborhood: parsed.data.neighborhood ?? null,
    address: parsed.data.address ?? null,
    price: parsed.data.price,
    rooms: parsed.data.rooms ?? null,
    sqm: parsed.data.sqm ?? null,
    amenities: parsed.data.amenities ?? null,
    available_from: parsed.data.available_from ?? null,
    link: parsed.data.link ?? null,
    images: parsed.data.images ?? null,
    source: parsed.data.source_id,
    is_active: parsed.data.is_active ?? true,
  }

  const { data, error } = await sb
    .from('properties')
    .upsert(upsertPayload, { onConflict: 'org_id,external_id' })
    .select()
    .limit(1)

  if(error){
    await sb.from('inbound_events').update({ status: 'failed', reason: error.message }).eq('org_id', orgId).eq('idempotency_key', idem)
    return NextResponse.json({ error: { code: 'UPSERT_FAILED', message: error.message } }, { status: 422 })
  }

  await sb.from('inbound_events').update({ status: 'processed' }).eq('org_id', orgId).eq('idempotency_key', idem)

  // if new vs updated
  const isUpdate = false // Best-effort; for now return 201
  const statusCode = isUpdate ? 200 : 201
  return NextResponse.json({ id: data?.[0]?.id, status: isUpdate ? 'updated' : 'created' }, { status: statusCode })
}

export async function GET(req: NextRequest){
  const url = new URL(req.url)
  const page = parseInt(url.searchParams.get('page') || '1')
  const limit = parseInt(url.searchParams.get('limit') || '50')
  const search = url.searchParams.get('search') || ''
  const city = url.searchParams.get('city') || ''
  const price_min = url.searchParams.get('price_min')
  const price_max = url.searchParams.get('price_max')
  const rooms_min = url.searchParams.get('rooms_min')
  const rooms_max = url.searchParams.get('rooms_max')
  const is_active = url.searchParams.get('is_active')
  const amenities = url.searchParams.get('amenities') // comma-separated list
  const is_brokerage = url.searchParams.get('is_brokerage') // true/false
  
  // Get user's org_id from cookie
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if(!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  
  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if(!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })
  
  const orgId = user.org_id
  const offset = (page - 1) * limit
  
  // Build query
  let query = sb
    .from('properties')
    .select('*', { count: 'exact' })
    .eq('org_id', orgId)
  
  // Apply filters
  if(search) {
    query = query.or(`title.ilike.%${search}%,city.ilike.%${search}%,neighborhood.ilike.%${search}%,address.ilike.%${search}%`)
  }
  if(city) {
    query = query.eq('city', city)
  }
  if(price_min) {
    query = query.gte('price', parseInt(price_min))
  }
  if(price_max) {
    query = query.lte('price', parseInt(price_max))
  }
  if(rooms_min) {
    query = query.gte('rooms', parseInt(rooms_min))
  }
  if(rooms_max) {
    query = query.lte('rooms', parseInt(rooms_max))
  }
  if(is_active !== null && is_active !== '') {
    query = query.eq('is_active', is_active === 'true')
  }
  if(amenities) {
    // Parse amenities filter
    const amenitiesList = amenities.split(',').filter(Boolean)
    if(amenitiesList.length > 0) {
      // Apply each amenity filter separately
      for(const amenity of amenitiesList) {
        query = query.eq(`amenities->${amenity}`, true)
      }
    }
  }
  if(is_brokerage !== null && is_brokerage !== '') {
    // Check if source contains "יד 2 תיווך" for brokerage
    if(is_brokerage === 'true') {
      query = query.ilike('source', '%יד 2 תיווך%')
    } else {
      query = query.not('source', 'ilike', '%יד 2 תיווך%')
    }
  }
  
  // Apply pagination and ordering
  query = query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  
  const { data, error, count } = await query
  
  if(error) {
    return NextResponse.json({ error: { code: 'QUERY_FAILED', message: error.message } }, { status: 500 })
  }
  
  const totalPages = Math.ceil((count || 0) / limit)
  
  return NextResponse.json({
    properties: data || [],
    pagination: {
      page,
      limit,
      total: count || 0,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1
    }
  })
}
