import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseService } from '../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../lib/auth'
import { dispatchInitialOutreach } from '../../../../../lib/outreach/dispatcher'

const STATUS_FOR_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  BLOCKED: 403,
  SUPPRESSED: 403,
  ALREADY_SENT: 409,
  PHONE_MISSING: 422,
  PERSONALIZATION: 422,
  TEMPLATE_MISSING: 500,
  TEMPLATE_NOT_APPROVED: 503,
  META_SEND_FAILED: 502,
  DB_ERROR: 500,
}

export async function POST(req: NextRequest) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })

  let body: { propertyId?: string; force?: boolean; template?: string } = {}
  try {
    body = await req.json()
  } catch {/* allow empty body */}
  if (!body.propertyId) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'propertyId required' } }, { status: 400 })

  const templateChoice = (body.template === 'basic' || body.template === 'rich' || body.template === 'auto_quality')
    ? body.template
    : 'auto'

  const result = await dispatchInitialOutreach({
    orgId: user.org_id,
    propertyId: body.propertyId,
    force: body.force === true,
    templateChoice,
  })

  if (!result.ok) {
    const status = STATUS_FOR_CODE[result.code] ?? 500
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status })
  }
  const { ok: _ok, ...rest } = result
  return NextResponse.json({ ok: true, ...rest })
}
