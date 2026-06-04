import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../lib/auth'
import { cookies } from 'next/headers'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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

    // Get the property
    const { data: property, error } = await sb
      .from('properties')
      .select('*')
      .eq('org_id', user.org_id)
      .eq('id', params.id)
      .maybeSingle()

    if (error) {
      console.error('Database error:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }

    return NextResponse.json(property)
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Toggle a boolean amenity flag (currently: divided / garden) on a property.
// Body: { amenity: 'divided' | 'garden', value: boolean }
const TOGGLEABLE_AMENITIES = new Set(['divided', 'garden'])

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = cookies().get('sb-access-token')?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const uid = getUserIdFromSupabaseCookie(token)
    if (!uid) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })

    let body: { amenity?: unknown; value?: unknown } = {}
    try { body = await req.json() } catch {/* empty */}
    const amenity = String(body.amenity || '')
    if (!TOGGLEABLE_AMENITIES.has(amenity)) {
      return NextResponse.json({ error: 'amenity must be one of: divided, garden' }, { status: 400 })
    }
    const value = body.value === true

    const sb = supabaseService()
    const { data: user } = await sb.from('users').select('org_id').eq('id', uid).maybeSingle()
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const { data: property } = await sb
      .from('properties')
      .select('amenities')
      .eq('org_id', user.org_id)
      .eq('id', params.id)
      .maybeSingle()
    if (!property) return NextResponse.json({ error: 'Property not found' }, { status: 404 })

    const amenities = (property.amenities && typeof property.amenities === 'object')
      ? { ...(property.amenities as Record<string, unknown>) }
      : {}
    amenities[amenity] = value

    const { error } = await sb
      .from('properties')
      .update({ amenities })
      .eq('org_id', user.org_id)
      .eq('id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, amenity, value, amenities })
  } catch (error) {
    console.error('PATCH property error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}