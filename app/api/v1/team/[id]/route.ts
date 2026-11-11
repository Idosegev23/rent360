import { NextRequest, NextResponse } from 'next/server'
import { requireOrg, capabilitiesOf } from '../../../../../lib/api/org-context'
import { isRole } from '../../../../../lib/auth/permissions'
import { normalizePhone } from '../../../../../lib/whatsapp/meta-provider'

const forbidden = () => NextResponse.json({ error: { code: 'FORBIDDEN', message: 'אין הרשאה לפעולה הזו' } }, { status: 403 })

/**
 * Edit a staff member. Staff with `team.manage` can edit anyone (incl. role and active state);
 * everyone else can only edit their own name / phone / WhatsApp-alert opt-in.
 * DELETE = soft-deactivate, `team.manage` only.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const canManage = (await capabilitiesOf(ctx)).includes('team.manage')
  const isSelf = params.id === ctx.uid
  if (!canManage && !isSelf) return forbidden()

  let body: { name?: string; phone?: string; title?: string; is_active?: boolean; receives_alerts?: boolean; role?: string } = {}
  try { body = await req.json() } catch {/* empty */}
  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = String(body.name).trim()
  if (body.phone !== undefined) patch.phone = body.phone ? normalizePhone(String(body.phone)) : null
  if (body.receives_alerts !== undefined) patch.receives_alerts = !!body.receives_alerts
  if (canManage) {
    if (body.title !== undefined) patch.title = body.title || null
    if (body.is_active !== undefined) patch.is_active = !!body.is_active
    if (body.role !== undefined) {
      if (!isRole(body.role)) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'תפקיד לא מוכר' } }, { status: 400 })
      patch.role = body.role
    }
  } else if (body.title !== undefined || body.is_active !== undefined || body.role !== undefined) {
    return forbidden()
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'no fields' } }, { status: 400 })

  // Never let managers lock themselves out by demoting or deactivating their own account.
  if (isSelf && ((patch.role !== undefined && patch.role !== ctx.role) || patch.is_active === false)) {
    return NextResponse.json({ error: { code: 'SELF_LOCKOUT', message: 'אי אפשר לשנות תפקיד או להשבית את המשתמש שלכם. מישהו אחר מההנהלה יכול לעשות זאת.' } }, { status: 409 })
  }

  const { error } = await ctx.sb.from('users').update(patch).eq('id', params.id).eq('org_id', ctx.orgId)
  if (error) return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: error.message } }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  if (!(await capabilitiesOf(ctx)).includes('team.manage')) return forbidden()
  if (params.id === ctx.uid) {
    return NextResponse.json({ error: { code: 'SELF_LOCKOUT', message: 'אי אפשר להשבית את המשתמש שלכם.' } }, { status: 409 })
  }
  // Soft-deactivate (never hard-delete — preserves assignee/created_by FKs on tasks/meetings).
  const { error } = await ctx.sb.from('users').update({ is_active: false, receives_alerts: false }).eq('id', params.id).eq('org_id', ctx.orgId)
  if (error) return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: error.message } }, { status: 500 })
  return NextResponse.json({ ok: true, status: 'deactivated' })
}
