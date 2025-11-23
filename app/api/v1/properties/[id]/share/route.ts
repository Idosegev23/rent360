import { NextRequest, NextResponse } from 'next/server'
import { getUserIdFromSupabaseCookie } from '../../../../../../lib/auth'
import { supabaseService } from '../../../../../../lib/supabase'
import { cookies } from 'next/headers'
import { nanoid } from 'nanoid'
import { processPropertyForSharing } from '../../../../../../lib/ai-property-processor'

// POST - Create or get existing share link
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const propertyId = params.id
  
  // Get user's org_id from cookie
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if(!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  
  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if(!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })
  
  const orgId = user.org_id
  
  // Verify property exists and belongs to org, and get full details for AI processing
  const { data: property } = await sb
    .from('properties')
    .select('*')
    .eq('id', propertyId)
    .eq('org_id', orgId)
    .maybeSingle()
  
  if(!property) {
    return NextResponse.json({ error: { code: 'PROPERTY_NOT_FOUND' } }, { status: 404 })
  }
  
  // Check if share already exists
  const { data: existingShare } = await sb
    .from('property_shares')
    .select('*')
    .eq('property_id', propertyId)
    .eq('org_id', orgId)
    .maybeSingle()
  
  if(existingShare) {
    // Get current domain from request
    const protocol = req.headers.get('x-forwarded-proto') || 'http';
    const host = req.headers.get('host') || 'localhost:3000';
    const baseUrl = `${protocol}://${host}`;
    
    return NextResponse.json({
      share: existingShare,
      url: `${baseUrl}/share/${existingShare.token}`
    })
  }
  
  // Create new share with unique token
  const token = nanoid(12) // Generate 12-char random token
  
  // Process property with AI
  let aiProcessedData = null;
  try {
    aiProcessedData = await processPropertyForSharing({
      title: property.title,
      city: property.city,
      neighborhood: property.neighborhood,
      price: property.price,
      rooms: property.rooms,
      sqm: property.sqm,
      description: property.description,
      amenities: property.amenities,
      type: property.type,
      condition: property.condition,
      available_from: property.available_from,
      pets_allowed: property.pets_allowed,
      long_term: property.long_term,
    });
  } catch (aiError) {
    console.error('AI processing failed:', aiError);
    // Continue without AI processing - we'll still create the share
  }
  
  const { data: newShare, error } = await sb
    .from('property_shares')
    .insert({
      org_id: orgId,
      property_id: propertyId,
      token,
      created_by: userId,
      view_count: 0,
      ai_title: aiProcessedData?.ai_title || null,
      ai_description: aiProcessedData?.ai_description || null,
      ai_highlights: aiProcessedData?.ai_highlights || null,
      ai_processed_at: aiProcessedData ? new Date().toISOString() : null,
    })
    .select()
    .single()
  
  if(error) {
    return NextResponse.json({ error: { code: 'CREATE_FAILED', message: error.message } }, { status: 500 })
  }
  
  // Get current domain from request
  const protocol = req.headers.get('x-forwarded-proto') || 'http';
  const host = req.headers.get('host') || 'localhost:3000';
  const baseUrl = `${protocol}://${host}`;
  
  return NextResponse.json({
    share: newShare,
    url: `${baseUrl}/share/${newShare.token}`
  }, { status: 201 })
}

// GET - Get share statistics
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const propertyId = params.id
  
  // Get user's org_id from cookie
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if(!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  
  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if(!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })
  
  const orgId = user.org_id
  
  // Get share stats
  const { data: share } = await sb
    .from('property_shares')
    .select('*')
    .eq('property_id', propertyId)
    .eq('org_id', orgId)
    .maybeSingle()
  
  if(!share) {
    return NextResponse.json({ share: null })
  }
  
  // Get current domain from request
  const protocol = req.headers.get('x-forwarded-proto') || 'http';
  const host = req.headers.get('host') || 'localhost:3000';
  const baseUrl = `${protocol}://${host}`;
  
  return NextResponse.json({
    share,
    url: `${baseUrl}/share/${share.token}`
  })
}

