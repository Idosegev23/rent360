import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrg } from '@/lib/api/org-context'

const Body = z.object({ user_id: z.string().uuid().nullable() })

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  // If assigning, the target user must be in the same org.
  if (parsed.data.user_id) {
    const { data: u } = await ctx.sb
      .from('users')
      .select('id')
      .eq('id', parsed.data.user_id)
      .eq('org_id', ctx.orgId)
      .maybeSingle()
    if (!u) return NextResponse.json({ error: 'user_not_in_org' }, { status: 400 })
  }
  const { error } = await ctx.sb
    .from('threads')
    .update({ assigned_user_id: parsed.data.user_id })
    .eq('id', params.id)
    .eq('org_id', ctx.orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
