import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { customAlphabet } from 'nanoid'
import { getUserIdFromSupabaseCookie } from '../../../../../../lib/auth'
import { supabaseService } from '../../../../../../lib/supabase'
import { normalizePhone } from '../../../../../../lib/whatsapp/meta-provider'

/**
 * Generate a fresh questionnaire invite for an existing renter and return the
 * shareable /r/<token> link (plus a wa.me deep-link prefilled with it) so the
 * operator can re-send the (updated) questionnaire — e.g. to capture new fields
 * like חצר / דירה מחולקת that older submissions didn't have.
 */
const generateToken = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 12)

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const token = cookies().get('sb-access-token')?.value
  const uid = getUserIdFromSupabaseCookie(token)
  if (!uid) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id, name').eq('id', uid).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })

  const { data: renter } = await sb
    .from('renters')
    .select('id, first_name, last_name, phone')
    .eq('id', params.id)
    .maybeSingle()
  if (!renter) return NextResponse.json({ error: { code: 'RENTER_NOT_FOUND' } }, { status: 404 })
  if (!renter.phone) return NextResponse.json({ error: { code: 'NO_PHONE', message: 'אין מספר טלפון לשוכר' } }, { status: 400 })

  const inviteToken = generateToken()
  await sb.from('renter_invites').insert({
    token: inviteToken,
    first_name: renter.first_name || null,
    last_name: renter.last_name || null,
    phone: renter.phone,
    status: 'pending',
    created_by: user.name || uid,
  })

  const base = (process.env.APP_BASE_URL || 'https://rent360-vert.vercel.app').replace(/\/$/, '')
  const link = `${base}/r/${inviteToken}`
  const intl = normalizePhone(renter.phone)
  const message = `היי ${renter.first_name || ''}, כדי שנתאים לך דירות מדויקות יותר נעדכן את ההעדפות שלך — לוקח 2 דקות:\n${link}`.trim()
  const waUrl = `https://wa.me/${intl}?text=${encodeURIComponent(message)}`

  return NextResponse.json({ ok: true, token: inviteToken, link, waUrl })
}
