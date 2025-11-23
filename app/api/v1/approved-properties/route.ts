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
  
  // Step 1: Get approved property IDs with pagination and count
  let approvedQuery = sb
    .from('approved_properties')
    .select('id, property_id, approved_at, org_id', { count: 'exact' })
    .eq('org_id', orgId)
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
  
  // Step 4: Merge approved metadata with property data
  const enrichedProperties = propertiesData?.map(property => {
    const approval = approvedData.find(ap => ap.property_id === property.id)
    return {
      ...property,
      approval_id: approval?.id,
      approved_at: approval?.approved_at
    }
  }) || []
  
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

