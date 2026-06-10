import { NextRequest, NextResponse } from 'next/server'
import { requireOrg } from '../../../../../lib/api/org-context'
import { normalizePhone } from '../../../../../lib/whatsapp/meta-provider'

/** Edit a staff member (any authed user — identical permissions). DELETE = soft-deactivate. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  let body: { name?: string; phone?: string; title?: string; is_active?: boolean; receives_alerts?: boolean; role?: string } = {}
  try { body = await req.json() } catch {/* empty */}
  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = String(body.name).trim()
  if (body.phone !== undefined) patch.phone = body.phone ? normalizePhone(String(body.phone)) : null
  if (body.title !== undefined) patch.title = body.title || null
  if (body.is_active !== undefined) patch.is_active = !!body.is_active
  if (body.receives_alerts !== undefined) patch.receives_alerts = !!body.receives_alerts
  if (body.role !== undefined && ['owner', 'admin', 'agent', 'viewer'].includes(String(body.role))) patch.role = body.role
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'no fields' } }, { status: 400 })

  const { error } = await ctx.sb.from('users').update(patch).eq('id', params.id).eq('org_id', ctx.orgId)
  if (error) return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: error.message } }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  // Soft-deactivate (never hard-delete — preserves assignee/created_by FKs on tasks/meetings).
  const { error } = await ctx.sb.from('users').update({ is_active: false, receives_alerts: false }).eq('id', params.id).eq('org_id', ctx.orgId)
  if (error) return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: error.message } }, { status: 500 })
  return NextResponse.json({ ok: true, status: 'deactivated' })
}
