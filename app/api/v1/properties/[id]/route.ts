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

// Editable scalar columns for the "ערוך פרטים" form. Body: { fields: { ...subset } }.
// Each value is coerced to the column's type; '' / null clears the column (except required ones).
const EDITABLE_FIELDS: Record<string, 'text' | 'int' | 'num' | 'date' | 'bool'> = {
  title: 'text', city: 'text', neighborhood: 'text', street: 'text', address: 'text',
  price: 'int', rooms: 'num', sqm: 'int', floor: 'int',
  type: 'text', condition: 'text', status: 'text',
  available_from: 'date', evacuation_date: 'date',
  description: 'text', full_text: 'text',
  contact_name: 'text', contact_phone: 'text',
  pets_allowed: 'bool', smokers_allowed: 'bool', long_term: 'bool',
}
// NOT NULL columns — refuse to blank them.
const REQUIRED_FIELDS = new Set(['title', 'city', 'price'])

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = cookies().get('sb-access-token')?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const uid = getUserIdFromSupabaseCookie(token)
    if (!uid) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })

    let body: { amenity?: unknown; value?: unknown; fields?: unknown; images?: unknown } = {}
    try { body = await req.json() } catch {/* empty */}

    const sb = supabaseService()
    const { data: user } = await sb.from('users').select('org_id').eq('id', uid).maybeSingle()
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // --- Images edit: { images: string[] } — full replacement (reorder / remove / append). ---
    // The client uploads new files to storage first, then PATCHes the resulting ordered URL list.
    if (Array.isArray(body.images)) {
      const images = (body.images as unknown[])
        .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
        .map((u) => u.trim())
        .slice(0, 40)
      const { data: updated, error } = await sb
        .from('properties')
        .update({ images, updated_at: new Date().toISOString() })
        .eq('org_id', user.org_id)
        .eq('id', params.id)
        .select('id')
        .maybeSingle()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!updated) return NextResponse.json({ error: 'Property not found' }, { status: 404 })
      return NextResponse.json({ ok: true, images })
    }

    // --- General field edit: { fields: { ...subset } } ---
    if (body.fields && typeof body.fields === 'object') {
      const fields = body.fields as Record<string, unknown>
      const update: Record<string, unknown> = {}
      for (const [key, kind] of Object.entries(EDITABLE_FIELDS)) {
        if (!(key in fields)) continue
        const raw = fields[key]
        let val: unknown
        if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
          val = null
        } else if (kind === 'int') {
          const n = parseInt(String(raw), 10); val = Number.isFinite(n) ? n : null
        } else if (kind === 'num') {
          const n = parseFloat(String(raw)); val = Number.isFinite(n) ? n : null
        } else if (kind === 'bool') {
          val = (raw === true || raw === 'true') ? true : ((raw === false || raw === 'false') ? false : null)
        } else if (kind === 'date') {
          val = String(raw).slice(0, 10)
        } else {
          val = String(raw).trim()
        }
        if (REQUIRED_FIELDS.has(key) && (val === null || val === '')) {
          return NextResponse.json({ error: `שדה חובה חסר: ${key}` }, { status: 400 })
        }
        update[key] = val
      }
      if (Object.keys(update).length === 0) {
        return NextResponse.json({ error: 'אין שדות לעדכון' }, { status: 400 })
      }
      update.updated_at = new Date().toISOString()
      const { data: updated, error } = await sb
        .from('properties')
        .update(update)
        .eq('org_id', user.org_id)
        .eq('id', params.id)
        .select('id')
        .maybeSingle()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!updated) return NextResponse.json({ error: 'Property not found' }, { status: 404 })
      return NextResponse.json({ ok: true, updated: Object.keys(update) })
    }

    // --- Amenity toggle: { amenity, value } ---
    const amenity = String(body.amenity || '')
    if (!TOGGLEABLE_AMENITIES.has(amenity)) {
      return NextResponse.json({ error: 'amenity must be one of: divided, garden' }, { status: 400 })
    }
    const value = body.value === true

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