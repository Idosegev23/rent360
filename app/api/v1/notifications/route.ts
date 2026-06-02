import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseService } from '../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../lib/auth'

/**
 * Admin notifications feed. Currently surfaces renter "interested in viewing" events
 * (interest messages dropped by the /share CTA). Powers the Topbar bell + a dashboard
 * widget. Read-only, cookie-authed.
 */
export async function GET(_req: NextRequest) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })
  const orgId = user.org_id

  const { data: events } = await sb
    .from('messages')
    .select('id, property_id, created_at, metadata')
    .eq('org_id', orgId)
    .eq('meta_message_type', 'interest')
    .order('created_at', { ascending: false })
    .limit(30)

  const renterIds = Array.from(new Set((events || []).map(e => (e.metadata as any)?.renter_id).filter(Boolean)))
  const propertyIds = Array.from(new Set((events || []).map(e => e.property_id).filter(Boolean)))

  const renterById = new Map<string, string>()
  if (renterIds.length) {
    const { data: rs } = await sb.from('renters').select('id, first_name, last_name').in('id', renterIds)
    for (const r of rs || []) renterById.set(r.id, [r.first_name, r.last_name].filter(Boolean).join(' ') || 'שוכר')
  }
  const locationById = new Map<string, string>()
  if (propertyIds.length) {
    const { data: ps } = await sb.from('properties').select('id, city, neighborhood, street').in('id', propertyIds)
    for (const p of ps || []) locationById.set(p.id, p.neighborhood ? `${p.city} · ${p.neighborhood}` : (p.city || p.street || 'דירה'))
  }

  const items = (events || []).map(e => {
    const rid = (e.metadata as any)?.renter_id || null
    return {
      id: e.id,
      type: 'interest' as const,
      renterId: rid,
      renterName: rid ? (renterById.get(rid) || 'שוכר') : 'שוכר',
      propertyId: e.property_id,
      propertyLocation: e.property_id ? (locationById.get(e.property_id) || 'דירה') : 'דירה',
      createdAt: e.created_at,
    }
  })

  return NextResponse.json({ items })
}
