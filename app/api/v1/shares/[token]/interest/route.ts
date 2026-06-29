import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../../lib/supabase'
import { recordRenterInterest } from '../../../../../../lib/outreach/renter-interest'

/**
 * Public: a renter clicked "מעוניין/ת לראות את הדירה" on their /share link.
 *
 * Records the interest so it surfaces in the admin inbox (drops an inbound message on the renter's
 * thread, flags it for human attention, alerts the office). The token (renter-linked share) tells us
 * which renter + property. No auth — the renter arrives from a WhatsApp link. Allowlisted in
 * middleware via /api/v1/shares/. Shares the recorder with the renter reply-bot's express_interest tool.
 */
export async function POST(_req: NextRequest, { params }: { params: { token: string } }) {
  const sb = supabaseService()

  const { data: share } = await sb
    .from('property_shares')
    .select('org_id, property_id, renter_id, match_id')
    .eq('token', params.token)
    .maybeSingle()
  if (!share) return NextResponse.json({ error: { code: 'SHARE_NOT_FOUND' } }, { status: 404 })

  // No renter attribution (generic property share) — acknowledge without recording.
  if (!share.renter_id) return NextResponse.json({ ok: true, recorded: false })

  const res = await recordRenterInterest({
    orgId: share.org_id,
    renterId: share.renter_id,
    propertyId: share.property_id,
    matchId: share.match_id ?? null,
    flipToHumanTakeover: true, // a tap from the share page hands the conversation to a human
    source: 'share_link',
  })

  return NextResponse.json({ ok: res.ok, recorded: res.recorded })
}
