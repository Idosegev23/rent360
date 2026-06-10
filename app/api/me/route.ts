import { NextResponse } from 'next/server'
import { requireOrg } from '@/lib/api/org-context'
import { getConnection } from '@/lib/google/connections'

export async function GET() {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { data: user } = await ctx.sb
    .from('users')
    .select('id, name, email, role, title')
    .eq('id', ctx.uid)
    .maybeSingle()
  const conn = await getConnection(ctx.orgId, ctx.uid)
  return NextResponse.json({
    id: ctx.uid,
    name: user?.name ?? null,
    email: user?.email ?? null,
    role: user?.role ?? null,
    title: user?.title ?? null,
    google: { connected: !!conn && conn.status === 'active', email: conn?.google_email ?? null },
  })
}
