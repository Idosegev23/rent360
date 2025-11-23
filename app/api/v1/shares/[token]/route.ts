import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'

// GET - Public endpoint to view shared property
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const token = params.token
  
  const sb = supabaseService()
  
  // Find share by token (include AI processed data)
  const { data: share, error: shareError } = await sb
    .from('property_shares')
    .select('id, property_id, view_count, created_at, ai_title, ai_description, ai_highlights')
    .eq('token', token)
    .maybeSingle()
  
  if(shareError || !share) {
    return NextResponse.json({ error: { code: 'SHARE_NOT_FOUND' } }, { status: 404 })
  }
  
  // Get property details
  const { data: property, error: propertyError } = await sb
    .from('properties')
    .select('id, title, city, neighborhood, street, price, rooms, sqm, amenities, available_from, images, description, type, floor, condition, pets_allowed, smokers_allowed, long_term')
    .eq('id', share.property_id)
    .maybeSingle()
  
  if(propertyError || !property) {
    return NextResponse.json({ error: { code: 'PROPERTY_NOT_FOUND' } }, { status: 404 })
  }
  
  // Increment view count
  await sb
    .from('property_shares')
    .update({ 
      view_count: share.view_count + 1,
      last_viewed_at: new Date().toISOString()
    })
    .eq('id', share.id)
  
  // Return sanitized property data (without sensitive info)
  // Prefer AI-processed data if available
  return NextResponse.json({
    property: {
      id: property.id,
      // Use AI title if available, otherwise fallback to basic format
      title: share.ai_title || `${property.type || 'דירה'} ב${property.city}`,
      // Use AI description if available, otherwise use original
      description: share.ai_description || property.description,
      // Include AI highlights if available
      highlights: share.ai_highlights || null,
      city: property.city,
      neighborhood: property.neighborhood,
      price: property.price,
      rooms: property.rooms,
      sqm: property.sqm,
      amenities: property.amenities,
      available_from: property.available_from,
      images: property.images,
      type: property.type,
      pets_allowed: property.pets_allowed,
      smokers_allowed: property.smokers_allowed,
      long_term: property.long_term
    }
  })
}

