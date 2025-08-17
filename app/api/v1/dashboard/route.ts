import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { supabaseService } from '../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../lib/auth'

export async function GET(){
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if(!userId) return NextResponse.json({ error:{ code:'NO_SESSION' } }, { status: 401 })
  const sb = supabaseService()

  // Resolve org_id by user id
  const { data: user, error: uerr } = await sb.from('users').select('org_id, role, name').eq('id', userId).maybeSingle()
  if(uerr || !user) return NextResponse.json({ error:{ code:'NO_USER' } }, { status: 401 })
  const orgId = user.org_id

  const since7 = new Date(Date.now() - 7*24*60*60*1000).toISOString()
  const today = new Date(); today.setHours(0,0,0,0)

  const [leads7, matchesPending, importsErr] = await Promise.all([
    sb.from('leads').select('id', { count:'exact', head:true }).eq('org_id', orgId).gte('created_at', since7),
    sb.from('matches').select('id', { count:'exact', head:true }).eq('org_id', orgId).in('status', ['suggested','pending']),
    sb.from('imports').select('failed', { count:'exact' }).eq('org_id', orgId).gte('ran_at', since7)
  ])

  const kpis = {
    leads_last_7d: leads7.count || 0,
    matches_waiting: matchesPending.count || 0,
    import_errors_7d: (importsErr.data||[]).reduce((a:any,b:any)=>a+(b.failed||0),0),
    response_rate_7d: null,
    median_response_minutes: null,
    user_role: user.role,
    user_name: user.name || null,
  }

  // Needs attention
  const { data: failedMsgs } = await sb
    .from('messages')
    .select('id, body, created_at, lead_id, property_id')
    .eq('org_id', orgId)
    .eq('status', 'failed')
    .gte('created_at', today.toISOString())
    .limit(5)

  return NextResponse.json({ kpis, needs_attention: { failed_messages: failedMsgs || [] } })
}
