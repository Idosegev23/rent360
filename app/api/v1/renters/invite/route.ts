import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { customAlphabet } from 'nanoid'
import { supabaseService } from '../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../lib/auth'

// 12-char URL-safe token, lowercase alphanumeric — readable and unambiguous.
const generateToken = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 12)

function normalizePhoneIsrael(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '')
  if (digits.startsWith('+972')) return '0' + digits.slice(4)
  if (digits.startsWith('972')) return '0' + digits.slice(3)
  return digits
}

/** POST — create a new renter invite token. Admin only (cookie-auth). */
export async function POST(request: NextRequest) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('name').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })

  let body: any = {}
  try { body = await request.json() } catch {}
  const firstName = (body.first_name || '').trim()
  const lastName = (body.last_name || '').trim()
  const phoneRaw = (body.phone || '').trim()
  if (!firstName || !phoneRaw) {
    return NextResponse.json({ error: { code: 'MISSING', message: 'חסרים שם פרטי וטלפון' } }, { status: 400 })
  }
  const phone = normalizePhoneIsrael(phoneRaw)
  if (!/^0\d{8,9}$/.test(phone)) {
    return NextResponse.json({ error: { code: 'BAD_PHONE', message: 'מספר טלפון לא תקין' } }, { status: 400 })
  }

  const token = generateToken()
  const { error } = await sb.from('renter_invites').insert({
    token,
    first_name: firstName,
    last_name: lastName || null,
    phone,
    status: 'pending',
    created_by: user.name || userId,
  })
  if (error) {
    console.error('[invite create] failed:', error.message)
    return NextResponse.json({ error: { code: 'INSERT_FAILED', message: error.message } }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    token,
    first_name: firstName,
    last_name: lastName,
    phone,
  })
}

/** GET — list invites for admin dashboard. */
export async function GET() {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: invites, error } = await sb
    .from('renter_invites')
    .select('token, first_name, last_name, phone, status, created_at, opened_at, submitted_at, created_by')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) {
    return NextResponse.json({ error: { code: 'QUERY_FAILED', message: error.message } }, { status: 500 })
  }

  const counts = (invites || []).reduce((acc, i) => {
    const k = i.status || 'unknown'
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return NextResponse.json({ invites: invites || [], counts })
}
