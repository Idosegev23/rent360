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