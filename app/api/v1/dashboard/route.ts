import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { supabaseService } from '../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../lib/auth'

export async function GET(){
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if(!userId) return NextResponse.json({ error:{ code:'NO_SESSION' } }, { status: 401 })
  const sb = supabaseService()

  const { data: user, error: uerr } = await sb.from('users').select('org_id, role, name').eq('id', userId).maybeSingle()
  if(uerr || !user) return NextResponse.json({ error:{ code:'NO_USER' } }, { status: 401 })
  const orgId = user.org_id

  const since7 = new Date(Date.now() - 7*24*60*60*1000).toISOString()

  const [importsErr, approvedPropsCount, approvedPropsActive] = await Promise.all([
    sb.from('imports').select('failed', { count:'exact' }).eq('org_id', orgId).gte('ran_at', since7),
    sb.from('approved_properties').select('id', { count:'exact', head:true }).eq('org_id', orgId),
    sb.from('approved_properties')
      .select('property_id', { count:'exact', head:true })
      .eq('org_id', orgId)
      .not('property_id', 'is', null)
  ])

  const kpis = {
    import_errors_7d: (importsErr.data||[]).reduce((a:any,b:any)=>a+(b.failed||0),0),
    approved_properties: approvedPropsCount.count || 0,
    active_approved_properties: approvedPropsActive.count || 0,
    user_role: user.role,
    user_name: user.name || null,
  }

  return NextResponse.json({ kpis, needs_attention: { failed_messages: [] } })
}
