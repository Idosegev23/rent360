import { NextRequest, NextResponse } from 'next/server'
import { requireOrg } from '../../../../../lib/api/org-context'
import { computeMatchesInBackground } from '../../../../../lib/matching/orchestrator'
import { logActivity } from '../../../../../lib/activity/log'

/**
 * End a tenancy → re-rent: the property comes back on-market (is_active=true, outreach_blocked=false),
 * matches are recomputed (so suitable renters are re-tagged), and the lifecycle is logged on both the
 * property and the renter. Body: { status: 'ended' }.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { sb, orgId, uid } = ctx

  let body: { status?: string } = {}
  try { body = await req.json() } catch {/* empty */}
  if (body.status !== 'ended') return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'status must be "ended"' } }, { status: 400 })

  const { data: ten } = await sb.from('tenancies').select('id, property_id, renter_id, status').eq('id', params.id).eq('org_id', orgId).maybeSingle()
  if (!ten) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })

  await sb.from('tenancies').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', ten.id).eq('org_id', orgId)

  if (ten.property_id) {
    await sb.from('properties').update({ is_active: true, outreach_blocked: false }).eq('id', ten.property_id).eq('org_id', orgId)
    computeMatchesInBackground({ propertyId: ten.property_id })
    await logActivity({ orgId, entityType: 'property', entityId: ten.property_id, kind: 'status_change', body: 'השכירות הסתיימה — הנכס חזר לשוק (השכרה חוזרת), וההתאמות חושבו מחדש', authorUserId: uid })
  }
  if (ten.renter_id) {
    await logActivity({ orgId, entityType: 'renter', entityId: ten.renter_id, kind: 'status_change', body: 'השכירות הסתיימה', authorUserId: uid })
  }
  return NextResponse.json({ ok: true, status: 'ended' })
}
