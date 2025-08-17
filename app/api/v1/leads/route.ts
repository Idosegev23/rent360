import { NextRequest, NextResponse } from 'next/server'
import { LeadInput } from './types'
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

  const parsed = LeadInput.safeParse(json)
  if(!parsed.success){
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', issues: parsed.error.flatten() } }, { status: 422 })
  }

  const orgId = getOrgIdFromAuthHeader(auth)
  if(!orgId){
    return NextResponse.json({ error: { code: 'NO_ORG_IN_JWT' } }, { status: 401 })
  }

  // Demo fallback: if service role envs are missing, return accepted without DB
  if(!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE){
    return NextResponse.json({ status: 'demo', accepted: true, org_id: orgId }, { status: 201 })
  }

  const sb = supabaseService()

  // Idempotency check
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
    endpoint: 'POST /leads',
    payload: json as any,
    status: 'received',
    idempotency_key: idem,
  })

  // Determine if exists
  const { data: existingBySrc } = await sb
    .from('leads')
    .select('id')
    .eq('org_id', orgId)
    .eq('source_id', parsed.data.source_id)
    .eq('phone', parsed.data.phone)
    .maybeSingle()

  const isUpdate = Boolean(existingBySrc)

  const upsertPayload = {
    org_id: orgId,
    external_id: parsed.data.external_id ?? null,
    source_id: parsed.data.source_id,
    full_name: parsed.data.full_name ?? null,
    phone: parsed.data.phone,
    email: parsed.data.email ?? null,
    budget_min: parsed.data.budget_min ?? null,
    budget_max: parsed.data.budget_max ?? null,
    preferred_cities: parsed.data.preferred_cities ?? null,
    preferred_rooms: parsed.data.preferred_rooms ?? null,
    must_haves: parsed.data.must_haves ?? null,
    nice_to_haves: parsed.data.nice_to_haves ?? null,
    move_in_from: parsed.data.move_in_from ?? null,
    status: 'new' as string,
  }

  const { data, error } = await sb
    .from('leads')
    .upsert(upsertPayload, { onConflict: 'org_id,source_id,phone' })
    .select()
    .limit(1)

  if(error){
    await sb.from('inbound_events').update({ status: 'failed', reason: error.message }).eq('org_id', orgId).eq('idempotency_key', idem)
    return NextResponse.json({ error: { code: 'UPSERT_FAILED', message: error.message } }, { status: 422 })
  }

  await sb.from('inbound_events').update({ status: 'processed' }).eq('org_id', orgId).eq('idempotency_key', idem)

  const statusCode = isUpdate ? 200 : 201
  return NextResponse.json({ id: data?.[0]?.id, status: isUpdate ? 'updated' : 'created' }, { status: statusCode })
}

export async function GET(req: NextRequest) {
  try {
    // Get user session from cookies
    const cookieStore = cookies()
    const token = cookieStore.get('sb-access-token')?.value
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const uid = getUserIdFromSupabaseCookie(token)
    if (!uid) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const sb = supabaseService()
    
    // Get user's organization
    const { data: user } = await sb
      .from('users')
      .select('org_id')
      .eq('id', uid)
      .maybeSingle()

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Get all leads for the organization
    const { data: leads, error } = await sb
      .from('leads')
      .select('*')
      .eq('org_id', user.org_id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Database error:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    return NextResponse.json(leads || [])
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
