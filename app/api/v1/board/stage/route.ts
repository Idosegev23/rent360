import { NextRequest, NextResponse } from 'next/server'
import { requireOrg } from '../../../../../lib/api/org-context'
import { logActivity } from '../../../../../lib/activity/log'
import { MANUAL_STAGE_KEYS, isStageKey, stageLabel, type StageKey } from '../../../../../lib/board/stages'

/**
 * Set a property's board stage and/or note (spec §3).
 *  - `stage_changed_at` moves ONLY on a real stage change; a note edit never resets the clock.
 *  - A note-only save writes the note columns only, so it can never revert a stage change someone
 *    else made on the same property a moment earlier — two people share this board.
 *  - `signed` is rejected: an active tenancy is what makes a property signed.
 *  - A row set before a tenancy that has since ended is stale: the property is back on the market
 *    and reads as `new` (the same rule as GET), so any real stage chosen now restarts the clock.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { sb, orgId, uid } = ctx

  let body: { propertyId?: unknown; stage?: unknown; note?: unknown } = {}
  try { body = await req.json() } catch { /* empty body */ }
  const propertyId = typeof body.propertyId === 'string' ? body.propertyId : ''
  if (!propertyId) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'חסר מזהה נכס' } }, { status: 400 })

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
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'צריך לשלוח שלב או הערה' } }, { status: 400 })
  }

  const { data: prop } = await sb.from('properties').select('id').eq('id', propertyId).eq('org_id', orgId).maybeSingle()
  if (!prop) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'הנכס לא נמצא' } }, { status: 404 })

  const [existingRes, lastEndedRes] = await Promise.all([
    sb.from('deal_stages').select('stage, stage_changed_at, note').eq('property_id', propertyId).eq('org_id', orgId).maybeSingle(),
    sb.from('tenancies').select('ended_at').eq('property_id', propertyId).eq('org_id', orgId).eq('status', 'ended')
      .not('ended_at', 'is', null).order('ended_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (existingRes.error) return NextResponse.json({ error: { code: 'DB_ERROR', message: existingRes.error.message } }, { status: 500 })
  const existing = existingRes.data as { stage: string; stage_changed_at: string; note: string | null } | null
  const endedAt = (lastEndedRes.data?.ended_at as string | null | undefined) ?? null
  const staleByEnd = !!(existing && endedAt && new Date(endedAt).getTime() > new Date(existing.stage_changed_at).getTime())
  const prevStage: StageKey = existing && !staleByEnd && isStageKey(existing.stage) ? existing.stage : 'new'
  const stageChanged = stage !== null && stage !== prevStage
  const now = new Date().toISOString()

  let writeError: string | null = null
  if (stageChanged) {
    // A real stage change. Last writer wins on the stage itself — that is intended.
    const row: Record<string, unknown> = {
      property_id: propertyId, org_id: orgId, stage, stage_changed_at: now, updated_by: uid, updated_at: now,
    }
    if (noteProvided) row.note = note
    const { error } = await sb.from('deal_stages').upsert(row, { onConflict: 'property_id' })
    writeError = error?.message ?? null
  } else if (noteProvided) {
    const noteCols = { note, updated_by: uid, updated_at: now }
    if (existing) {
      // Note columns only — never `stage` or `stage_changed_at` on this path.
      const { error } = await sb.from('deal_stages').update(noteCols).eq('property_id', propertyId).eq('org_id', orgId)
      writeError = error?.message ?? null
    } else {
      // First row for this property, note only. INSERT (not upsert) so a row a concurrent stage change
      // just created is never overwritten; on that conflict, fall back to a note-only update. The clock
      // keeps running from when the property came (back) to market, not from now.
      const { data: ap } = await sb.from('approved_properties').select('approved_at')
        .eq('property_id', propertyId).eq('org_id', orgId).maybeSingle()
      const since = endedAt ?? (ap?.approved_at as string | null | undefined) ?? now
      const { error } = await sb.from('deal_stages').insert({
        property_id: propertyId, org_id: orgId, stage: 'new', stage_changed_at: since, ...noteCols,
      })
      if (error?.code === '23505') {
        const retry = await sb.from('deal_stages').update(noteCols).eq('property_id', propertyId).eq('org_id', orgId)
        writeError = retry.error?.message ?? null
      } else {
        writeError = error?.message ?? null
      }
    }
  }
  // else: the same stage re-posted with no note — nothing to write.
  if (writeError) return NextResponse.json({ error: { code: 'DB_ERROR', message: writeError } }, { status: 500 })

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
