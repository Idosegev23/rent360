import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseService } from '../../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../../lib/auth'
import { dispatchInitialOutreach } from '../../../../../../lib/outreach/dispatcher'

/**
 * Send a renter-driven recruitment message to an unapproved property's landlord. Reuses the standard
 * first-touch dispatcher (approved rich template), but swaps in a renter-aware personalization line
 * ("we have someone looking for exactly this kind of apartment in {city}") — no new Meta template, no
 * identifying renter details. Tags the outbound message with the renter for tracking. Body: { propertyId }.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })
  const orgId = user.org_id

  let body: { propertyId?: unknown } = {}
  try { body = await req.json() } catch {/* empty */}
  const propertyId = typeof body.propertyId === 'string' ? body.propertyId : ''
  if (!propertyId) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'propertyId required' } }, { status: 400 })

  const { data: renter } = await sb.from('renters').select('id, preferred_rooms').eq('id', params.id).maybeSingle()
  if (!renter) return NextResponse.json({ error: { code: 'RENTER_NOT_FOUND' } }, { status: 404 })
  const { data: prop } = await sb.from('properties').select('id, city, rooms').eq('id', propertyId).eq('org_id', orgId).maybeSingle()
  if (!prop) return NextResponse.json({ error: { code: 'PROPERTY_NOT_FOUND' } }, { status: 404 })

  const cityClean = (prop.city || '').replace(/\s*-\s*(מגורים|משרדים|rent).*$/i, '').trim()
  const rooms = renter.preferred_rooms ?? prop.rooms
  const roomsPart = rooms ? `דירת ${String(rooms).replace(/\.0$/, '')} חדרים ` : 'דירה '
  const hook = `יש לנו כרגע שוכר/ת רציני/ת שמחפש/ת ${roomsPart}ב${cityClean || 'אזור'} — הנכס שלכם מתאים בדיוק, ונשמח לעזור להשכיר אותו מהר.`.slice(0, 300)

  const res = await dispatchInitialOutreach({
    orgId,
    propertyId,
    personalHookOverride: hook,
    recruitedForRenterId: params.id,
  })
  if (!res.ok) return NextResponse.json({ error: { code: res.code, message: res.message } }, { status: 400 })
  return NextResponse.json({ ok: true, threadId: res.threadId, templateName: res.templateName })
}
