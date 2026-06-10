import { NextRequest, NextResponse } from 'next/server'
import { requireOrg } from '../../../../lib/api/org-context'

/** All properties of one owner (by contact_phone) — the "owner portfolio": see everything a landlord
 *  listed with us so we nurture, don't double-message, and spot re-rent opportunities. */
export async function GET(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const phone = new URL(req.url).searchParams.get('phone')?.trim()
  if (!phone) return NextResponse.json({ properties: [] })

  const { data } = await ctx.sb
    .from('properties')
    .select('id, contact_name, street, address, city, price, rooms, is_active, initial_message_sent, status')
    .eq('org_id', ctx.orgId)
    .eq('contact_phone', phone)
    .order('created_at', { ascending: false })
    .limit(100)
  return NextResponse.json({ properties: data || [] })
}
