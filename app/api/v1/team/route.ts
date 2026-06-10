import { NextRequest, NextResponse } from 'next/server'
import { requireOrg } from '../../../../lib/api/org-context'
import { normalizePhone } from '../../../../lib/whatsapp/meta-provider'

/**
 * Team directory. All 4 staff have identical permissions — any authed user can list AND add/edit
 * staff (no role gating). GET → the org's staff; POST → add a staff member (creates an auth user
 * so they can log in with Google by email, + a users row).
 */
export async function GET() {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { data, error } = await ctx.sb
    .from('users')
    .select('id, name, email, phone, role, title, is_active, receives_alerts, created_at')
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: { code: 'QUERY_FAILED', message: error.message } }, { status: 500 })
  return NextResponse.json({ members: data || [] })
}

export async function POST(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  let body: { name?: string; email?: string; phone?: string; title?: string; receives_alerts?: boolean } = {}
  try { body = await req.json() } catch {/* empty */}
  const email = String(body.email || '').trim().toLowerCase()
  const name = String(body.name || '').trim()
  if (!email || !name) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'name + email required' } }, { status: 400 })
  const phone = body.phone ? normalizePhone(String(body.phone)) : null

  // Already a member?
  const { data: existing } = await ctx.sb.from('users').select('id').ilike('email', email).maybeSingle()
  if (existing) {
    await ctx.sb.from('users').update({
      name, phone, title: body.title ?? null, is_active: true,
      receives_alerts: body.receives_alerts ?? true,
    }).eq('id', existing.id)
    return NextResponse.json({ ok: true, status: 'updated', id: existing.id })
  }

  // Create the auth user (Google links by email on first login) + the users row.
  let authId: string | undefined
  const created = await ctx.sb.auth.admin.createUser({ email, email_confirm: true, app_metadata: { org_id: ctx.orgId } })
  authId = created.data?.user?.id
  if (!authId) {
    const list = await ctx.sb.auth.admin.listUsers()
    authId = list.data?.users?.find(u => (u.email || '').toLowerCase() === email)?.id
  }
  if (!authId) return NextResponse.json({ error: { code: 'AUTH_CREATE_FAILED', message: created.error?.message || 'no auth id' } }, { status: 500 })

  const { error: insErr } = await ctx.sb.from('users').insert({
    id: authId, org_id: ctx.orgId, email, name, phone, role: 'admin',
    title: body.title ?? null, is_active: true, receives_alerts: body.receives_alerts ?? true,
  })
  if (insErr) return NextResponse.json({ error: { code: 'INSERT_FAILED', message: insErr.message } }, { status: 500 })
  return NextResponse.json({ ok: true, status: 'created', id: authId })
}
