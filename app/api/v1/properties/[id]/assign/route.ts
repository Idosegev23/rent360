import { NextRequest, NextResponse } from 'next/server'
import { requireOrg } from '../../../../../../lib/api/org-context'

/** Assign (or clear) the agent responsible for a property. Everything downstream — interest alerts,
 *  viewing coordination — routes to this agent. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  let body: { agentUserId?: string | null } = {}
  try { body = await req.json() } catch {/* empty */}
  const agentUserId = body.agentUserId || null

  if (agentUserId) {
    const { data: agent } = await ctx.sb.from('users').select('id, handles_properties, is_active').eq('id', agentUserId).eq('org_id', ctx.orgId).maybeSingle()
    if (!agent || agent.is_active === false) return NextResponse.json({ error: { code: 'BAD_AGENT' } }, { status: 400 })
  }
  const { error } = await ctx.sb.from('properties').update({ assigned_agent_user_id: agentUserId }).eq('id', params.id).eq('org_id', ctx.orgId)
  if (error) return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: error.message } }, { status: 500 })
  return NextResponse.json({ ok: true, assigned_agent_user_id: agentUserId })
}
