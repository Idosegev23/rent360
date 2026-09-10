import { NextRequest, NextResponse } from 'next/server'
import { requireOrg } from '../../../../../lib/api/org-context'
import { logActivity } from '../../../../../lib/activity/log'

/**
 * Claim an unassigned property from the board's orphans strip for the viewer. The update is
 * conditional on the property still being unassigned, so two people claiming the same orphan from
 * lists loaded earlier cannot silently take it from each other — the second gets 409.
 * (The general `POST /api/v1/properties/[id]/assign` overwrites by design: it serves the property
 * page's reassign control, where replacing the agent is the point.)
 */
export async function POST(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { sb, orgId, uid } = ctx

  let body: { propertyId?: unknown } = {}
  try { body = await req.json() } catch { /* empty body */ }
  const propertyId = typeof body.propertyId === 'string' ? body.propertyId : ''
  if (!propertyId) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'חסר מזהה נכס' } }, { status: 400 })

  // requireOrg() already rejects inactive users, so `uid` is always an active agent here.
  const { data, error } = await sb.from('properties')
    .update({ assigned_agent_user_id: uid })
    .eq('id', propertyId).eq('org_id', orgId).is('assigned_agent_user_id', null)
    .select('id')
  if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })

  if (!data?.length) {
    const { data: exists } = await sb.from('properties').select('id').eq('id', propertyId).eq('org_id', orgId).maybeSingle()
    return exists
      ? NextResponse.json({ error: { code: 'ALREADY_ASSIGNED', message: 'הנכס כבר שויך לסוכן אחר' } }, { status: 409 })
      : NextResponse.json({ error: { code: 'NOT_FOUND', message: 'הנכס לא נמצא' } }, { status: 404 })
  }

  await logActivity({
    orgId, entityType: 'property', entityId: propertyId, kind: 'system', authorUserId: uid,
    body: 'שיוך מלוח הבקרה', metadata: { board: true, assigned_to: uid },
  })
  return NextResponse.json({ ok: true })
}
