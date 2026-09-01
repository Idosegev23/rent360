import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { requireAdminOrg } from '../../../../../lib/outreach/admin-context'

/**
 * Mark one `renewal_leads` row permanently skipped (operator decision — "not relevant", already
 * renewed elsewhere, etc.), org-scoped. Unlike the transient failure codes `dispatchRenewalOutreach`
 * itself can return, this is a deliberate, permanent operator action, so it always stamps.
 *
 * Body: `{ leadId: string, reason?: string }`.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireAdminOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { orgId } = ctx
  const sb = supabaseService()

  let body: { leadId?: unknown; reason?: unknown } = {}
  try {
    body = await req.json()
  } catch {/* allow empty body */}

  if (typeof body.leadId !== 'string' || !body.leadId) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'leadId required' } }, { status: 400 })
  }
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'manual'

  const { data, error } = await sb
    .from('renewal_leads')
    .update({ status: 'skipped', skip_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', body.leadId)
    .eq('org_id', orgId)
    .select('id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })
  if (!data) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'הליד לא נמצא' } }, { status: 404 })

  return NextResponse.json({ ok: true })
}
