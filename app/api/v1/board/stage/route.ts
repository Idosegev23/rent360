import { NextRequest, NextResponse } from 'next/server'
import { requireOrg } from '../../../../../lib/api/org-context'
import { logActivity } from '../../../../../lib/activity/log'
import { MANUAL_STAGE_KEYS, isStageKey, stageLabel, type StageKey } from '../../../../../lib/board/stages'

/**
 * Set a property's board stage and/or note. `stage_changed_at` moves ONLY on a real stage change —
 * a note edit must not make a stuck deal look fresh (spec §3). `signed` is rejected: an active
 * tenancy is what makes a property signed.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { sb, orgId, uid } = ctx

  let body: { propertyId?: unknown; stage?: unknown; note?: unknown } = {}
  try { body = await req.json() } catch { /* empty body */ }
  const propertyId = typeof body.propertyId === 'string' ? body.propertyId : ''
  if (!propertyId) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'propertyId required' } }, { status: 400 })

  let stage: StageKey | null = null
  if (body.stage !== undefined) {
    if (!isStageKey(body.stage) || !MANUAL_STAGE_KEYS.includes(body.stage)) {
      return NextResponse.json({ error: { code: 'BAD_STAGE', message: 'שלב לא חוקי. "חוזה נחתם" נקבע אוטומטית לפי רישום השכירות.' } }, { status: 400 })
    }
    stage = body.stage
  }
  const noteProvided = body.note !== undefined
  const note = typeof body.note === 'string' ? (body.note.trim().slice(0, 2000) || null) : null
  if (stage === null && !noteProvided) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'stage or note required' } }, { status: 400 })
  }

  const { data: prop } = await sb.from('properties').select('id').eq('id', propertyId).eq('org_id', orgId).maybeSingle()
  if (!prop) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })

  const { data: existing } = await sb.from('deal_stages').select('stage, note')
    .eq('property_id', propertyId).eq('org_id', orgId).maybeSingle()
  const prevStage = (existing?.stage as StageKey | undefined) ?? 'new'
  const stageChanged = stage !== null && stage !== prevStage
  const now = new Date().toISOString()

  const row: Record<string, unknown> = {
    property_id: propertyId, org_id: orgId, updated_by: uid, updated_at: now,
    stage: stage ?? prevStage,
  }
  if (stageChanged) {
    row.stage_changed_at = now
  } else if (!existing) {
    // First row with no stage change: keep the clock running from approval rather than restarting it.
    const { data: ap } = await sb.from('approved_properties').select('approved_at')
      .eq('property_id', propertyId).eq('org_id', orgId).maybeSingle()
    row.stage_changed_at = (ap?.approved_at as string | null) ?? now
  }
  if (noteProvided) row.note = note

  const { error } = await sb.from('deal_stages').upsert(row, { onConflict: 'property_id' })
  if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })

  if (stageChanged && stage) {
    await logActivity({
      orgId, entityType: 'property', entityId: propertyId, kind: 'status_change', authorUserId: uid,
      body: `שלב: ${stageLabel(prevStage)} ← ${stageLabel(stage)}`,
      metadata: { board: true, from: prevStage, to: stage },
    })
  }
  if (noteProvided && note && note !== existing?.note) {
    await logActivity({ orgId, entityType: 'property', entityId: propertyId, kind: 'note', authorUserId: uid, body: note, metadata: { board: true } })
  }
  return NextResponse.json({ ok: true, stageChanged })
}
