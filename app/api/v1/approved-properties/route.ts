import { NextRequest, NextResponse } from 'next/server'
import { getUserIdFromSupabaseCookie } from '../../../../lib/auth'
import { supabaseService } from '../../../../lib/supabase'
import { cookies } from 'next/headers'

export async function GET(req: NextRequest){
  const url = new URL(req.url)
  const page = parseInt(url.searchParams.get('page') || '1')
  const limit = parseInt(url.searchParams.get('limit') || '50')
  const search = url.searchParams.get('search') || ''
  const city = url.searchParams.get('city') || ''
  const neighborhood = url.searchParams.get('neighborhood') || ''
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

  // A property that's been rented (has an ACTIVE tenancy) is off-market — it must drop out of the
  // "approved" list, same way a placed renter drops out of the seekers list. Tenancies are the
  // source of truth for "rented" (set alongside properties.is_active=false at close-deal time).
  const { data: activeTen } = await sb
    .from('tenancies')
    .select('property_id')
    .eq('org_id', orgId)
    .eq('status', 'active')
  const rentedIds = Array.from(new Set((activeTen || []).map(t => t.property_id).filter(Boolean))) as string[]

  // Step 1: Get approved property IDs with pagination and count.
  // Default list excludes "irrelevant" approvals; ?irrelevant=1 returns only those.
  const wantIrrelevant = url.searchParams.get('irrelevant') === '1'
  let approvedQuery = sb
    .from('approved_properties')
    .select('*', { count: 'exact' })
    .eq('org_id', orgId)
  approvedQuery = wantIrrelevant
    ? approvedQuery.not('irrelevant_at', 'is', null)
    : approvedQuery.is('irrelevant_at', null)
  if (rentedIds.length) approvedQuery = approvedQuery.not('property_id', 'in', `(${rentedIds.join(',')})`)
  approvedQuery = approvedQuery
    .order('approved_at', { ascending: false })
    .range(offset, offset + limit - 1)
  
  const { data: approvedData, error: approvedError, count } = await approvedQuery
  
  if(approvedError) {
    return NextResponse.json({ error: { code: 'QUERY_FAILED', message: approvedError.message } }, { status: 500 })
  }
  
  if(!approvedData || approvedData.length === 0) {
    return NextResponse.json({
      properties: [],
      pagination: {
        page,
        limit,
        total: 0,
        totalPages: 0,
        hasNext: false,
        hasPrev: false
      }
    })
  }
  
  // Step 2: Get the property IDs
  const propertyIds = approvedData.map(ap => ap.property_id)
  
  // Step 3: Fetch full property details
  let propertiesQuery = sb
    .from('properties')
    .select('*')
    .in('id', propertyIds)
    .eq('org_id', orgId)
  
  // Apply filters
  if(search) {
    propertiesQuery = propertiesQuery.or(`title.ilike.%${search}%,city.ilike.%${search}%,neighborhood.ilike.%${search}%,address.ilike.%${search}%`)
  }
  if(city) {
    propertiesQuery = propertiesQuery.eq('city', city)
  }
  if(neighborhood) {
    propertiesQuery = propertiesQuery.eq('neighborhood', neighborhood)
  }
  if(price_min) {
    propertiesQuery = propertiesQuery.gte('price', parseInt(price_min))
  }
  if(price_max) {
    propertiesQuery = propertiesQuery.lte('price', parseInt(price_max))
  }
  if(rooms_min) {
    propertiesQuery = propertiesQuery.gte('rooms', parseInt(rooms_min))
  }
  if(rooms_max) {
    propertiesQuery = propertiesQuery.lte('rooms', parseInt(rooms_max))
  }
  if(is_active !== null && is_active !== '') {
    propertiesQuery = propertiesQuery.eq('is_active', is_active === 'true')
  }
  if(amenities) {
    const amenitiesList = amenities.split(',').filter(Boolean)
    if(amenitiesList.length > 0) {
      for(const amenity of amenitiesList) {
        propertiesQuery = propertiesQuery.eq(`amenities->${amenity}`, true)
      }
    }
  }
  if(is_brokerage !== null && is_brokerage !== '') {
    if(is_brokerage === 'true') {
      propertiesQuery = propertiesQuery.ilike('source', '%יד 2 תיווך%')
    } else {
      propertiesQuery = propertiesQuery.not('source', 'ilike', '%יד 2 תיווך%')
    }
  }
  
  const { data: propertiesData, error: propertiesError } = await propertiesQuery
  
  if(propertiesError) {
    return NextResponse.json({ error: { code: 'QUERY_FAILED', message: propertiesError.message } }, { status: 500 })
  }
  
  // Step 3.5: Resolve approver names for manual approvals
  const approverIds = Array.from(
    new Set(
      approvedData
        .map(ap => ap.approved_by)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  )
  const approverNameById = new Map<string, string>()
  if (approverIds.length > 0) {
    const { data: approvers } = await sb
      .from('users')
      .select('id, name')
      .in('id', approverIds)
    for (const u of approvers || []) {
      if (u?.id) approverNameById.set(u.id, u.name || '')
    }
  }

  // Step 3.6: Resolve match counts (non-DQ) per property
  const propertyIdsForMatches = (propertiesData || []).map(p => p.id)
  const matchAggByProperty = new Map<string, { count: number; topScore: number | null }>()
  if (propertyIdsForMatches.length > 0) {
    const { data: matchRows } = await sb
      .from('matches')
      .select('property_id, score, is_disqualified')
      .eq('org_id', orgId)
      .in('property_id', propertyIdsForMatches)
      .eq('is_disqualified', false)
    for (const m of matchRows || []) {
      const pid = (m as any).property_id as string
      const score = Number((m as any).score) || 0
      const cur = matchAggByProperty.get(pid) || { count: 0, topScore: null }
      cur.count += 1
      if (cur.topScore === null || score > cur.topScore) cur.topScore = score
      matchAggByProperty.set(pid, cur)
    }
  }

  // Step 4: Merge approved metadata with property data, preserving approved_at desc order from Step 1
  const propertiesById = new Map((propertiesData || []).map(p => [p.id, p]))
  const enrichedProperties = approvedData
    .map(approval => {
      const property = propertiesById.get(approval.property_id)
      if (!property) return null
      const agg = matchAggByProperty.get(property.id) || { count: 0, topScore: null }
      return {
        ...property,
        approval_id: approval.id,
        approved_at: approval.approved_at,
        approval_method: approval.approval_method || 'questionnaire',
        approved_by: approval.approved_by || null,
        approved_by_name: approval.approved_by ? approverNameById.get(approval.approved_by) || null : null,
        approval_summary: (approval as any).approval_summary || null,
        approval_transcript: (approval as any).conversation_transcript || null,
        irrelevant_at: (approval as any).irrelevant_at || null,
        irrelevant_reason: (approval as any).irrelevant_reason || null,
        recheck_at: (approval as any).recheck_at || null,
        matches_count: agg.count,
        matches_top_score: agg.topScore,
      }
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
  
  const totalPages = Math.ceil((count || 0) / limit)
  
  return NextResponse.json({
    properties: enrichedProperties,
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

