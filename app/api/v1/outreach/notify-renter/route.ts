import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseService } from '../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../lib/auth'
import { dispatchRenterMatchAlert } from '../../../../../lib/outreach/renter-alert'
import { RENTER_PER_DAY_CAP, renterSendCounts } from '../../../../../lib/outreach/governance'

const STATUS_FOR_CODE: Record<string, number> = {
  RENTER_NOT_FOUND: 404,
  PROPERTY_NOT_FOUND: 404,
  MATCH_NOT_FOUND: 404,
  SUPPRESSED: 403,
  ALREADY_NOTIFIED: 409,
  PHONE_MISSING: 422,
  NO_IMAGE: 422,
  ROOMS_MISSING: 422,
  PRICE_MISSING: 422,
  CITY_MISSING: 422,
  TEMPLATE_MISSING: 500,
  TEMPLATE_NOT_APPROVED: 503,
  META_SEND_FAILED: 502,
  DB_ERROR: 500,
}

/**
 * Admin single-send of the renter match alert.
 * Body: `{ matchId }` (preferred) or `{ renterId, propertyId, force? }`.
 */
export async function POST(req: NextRequest) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })
  const orgId = user.org_id

  let body: { matchId?: string; renterId?: string; propertyId?: string; force?: boolean; confirmOverCap?: boolean } = {}
  try {
    body = await req.json()
  } catch {/* allow empty body */}

  let renterId = body.renterId
  let propertyId = body.propertyId
  const matchId = body.matchId

  // Resolve renter/property from the match row when only matchId is given.
  if (matchId && (!renterId || !propertyId)) {
    const { data: match } = await sb
      .from('matches')
      .select('renter_id, property_id, org_id')
      .eq('id', matchId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (!match) return NextResponse.json({ error: { code: 'MATCH_NOT_FOUND' } }, { status: 404 })
    renterId = match.renter_id
    propertyId = match.property_id
  }

  if (!renterId || !propertyId) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'matchId or (renterId & propertyId) required' } }, { status: 400 })
  }

  // Over-cap warn-and-confirm: manual sends self-govern, but we surface the day's
  // count so the operator must explicitly confirm sending past the per-day cap.
  if (body.confirmOverCap !== true) {
    const counts = await renterSendCounts(orgId, [renterId])
    const sentToday = counts[renterId]?.today ?? 0
    if (sentToday >= RENTER_PER_DAY_CAP) {
      return NextResponse.json({
        error: {
          code: 'CAP_WARNING',
          message: `כבר נשלחו ${sentToday} התאמות לשוכר היום (תקרה ${RENTER_PER_DAY_CAP}). לשלוח בכל זאת?`,
          sentToday,
        },
      }, { status: 409 })
    }
  }

  const result = await dispatchRenterMatchAlert({
    orgId,
    renterId,
    propertyId,
    matchId,
    force: body.force === true,
    sentByUserId: userId,
  })

  if (!result.ok) {
    const status = STATUS_FOR_CODE[result.code] ?? 500
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status })
  }
  const { ok: _ok, ...rest } = result
  return NextResponse.json({ ok: true, ...rest })
}
