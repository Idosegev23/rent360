import { NextRequest, NextResponse } from 'next/server'
import { PropertyInput } from './types'
import { getOrgIdFromAuthHeader } from '../../../../lib/auth'
import { supabaseService } from '../../../../lib/supabase'

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
