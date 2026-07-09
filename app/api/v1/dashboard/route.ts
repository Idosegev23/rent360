import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { supabaseService } from '../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../lib/auth'

export async function GET() {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const sb = supabaseService()

  const { data: user, error: uerr } = await sb.from('users').select('org_id, role, name').eq('id', userId).maybeSingle()
  if (uerr || !user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })
  const orgId = user.org_id

  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [
    importsErr,
    rentersCount,
    rentersSinceWeek,
    matchesAll,
    outreachAllTime,
    outreachToday,
    inboundToday,
    activeThreads,
    handoffPending,
    optedOut,
  ] = await Promise.all([
    sb.from('imports').select('failed', { count: 'exact' }).eq('org_id', orgId).gte('ran_at', since7),
    sb.from('renters').select('id', { count: 'exact', head: true }),
    sb.from('renters').select('id', { count: 'exact', head: true }).gte('created_at', since7),
    sb.from('matches').select('score, is_disqualified').eq('org_id', orgId),
    sb.from('messages').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('direction', 'out').eq('meta_message_type', 'template'),
    sb.from('messages').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('direction', 'out').eq('meta_message_type', 'template').gte('created_at', todayStart.toISOString()),
    sb.from('messages').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('direction', 'in').gte('created_at', since24),
    sb.from('threads').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('channel', 'whatsapp').not('status', 'in', '("closed_won","closed_lost","opted_out","admin_alerts")'),
    sb.from('threads').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'human_takeover'),
    sb.from('threads').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'opted_out'),
  ])

  const allMatches = matchesAll.data || []
  const nonDqMatches = allMatches.filter(m => !m.is_disqualified)
  const matchesAvgScore = nonDqMatches.length
    ? Math.round(nonDqMatches.reduce((s, m) => s + (Number(m.score) || 0), 0) / nonDqMatches.length)
    : null

  // "Approved" must match the /approved-properties page, not raw approved_properties rows —
  // otherwise the dashboard over-counts approvals marked irrelevant + already-rented ones.
  // approved_properties = approved AND not irrelevant AND not rented (active tenancy).
  // active_approved_properties = of those, still on-market (is_active=true).
  const [apprRowsRes, activeTenRes] = await Promise.all([
    sb.from('approved_properties').select('property_id').eq('org_id', orgId).is('irrelevant_at', null),
    sb.from('tenancies').select('property_id').eq('org_id', orgId).eq('status', 'active'),
  ])
  const rentedSet = new Set((activeTenRes.data || []).map(t => t.property_id).filter(Boolean))
  const approvedPropIds = Array.from(new Set((apprRowsRes.data || []).map(a => a.property_id).filter(Boolean)))
    .filter(id => !rentedSet.has(id))
  let activeApprovedCount = 0
  if (approvedPropIds.length) {
    const { count } = await sb
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('is_active', true)
      .in('id', approvedPropIds)
    activeApprovedCount = count || 0
  }
  const approvedTotal = approvedPropIds.length

  const kpis = {
    import_errors_7d: (importsErr.data || []).reduce((a: any, b: any) => a + (b.failed || 0), 0),
    approved_properties: approvedTotal,
    active_approved_properties: activeApprovedCount,
    renters_pool: rentersCount.count || 0,
    renters_new_7d: rentersSinceWeek.count || 0,
    matches_total: allMatches.length,
    matches_active: nonDqMatches.length,
    matches_avg_score: matchesAvgScore,
    outreach_sent_total: outreachAllTime.count || 0,
    outreach_sent_today: outreachToday.count || 0,
    inbound_24h: inboundToday.count || 0,
    active_threads: activeThreads.count || 0,
    handoff_pending: handoffPending.count || 0,
    opted_out: optedOut.count || 0,
    user_role: user.role,
    user_name: user.name || null,
  }

  // Recent activity history — last 12 events across multiple streams
  const [recentApproved, recentOutreach, recentRenters, recentHandoffs] = await Promise.all([
    sb.from('approved_properties')
      .select('approved_at, property_id, approval_method, approved_by, properties:properties!inner(title, city)')
      .eq('org_id', orgId)
      .order('approved_at', { ascending: false })
      .limit(6),
    sb.from('messages')
      .select('id, created_at, thread_id, template_name, body, threads:threads(phone)')
      .eq('org_id', orgId)
      .eq('direction', 'out')
      .eq('meta_message_type', 'template')
      .order('created_at', { ascending: false })
      .limit(6),
    sb.from('renters')
      .select('id, first_name, last_name, phone, created_at, preferred_cities')
      .order('created_at', { ascending: false })
      .limit(6),
    sb.from('conversation_alerts')
      .select('id, created_at, type, thread_id, payload')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(6),
  ])

  const history: Array<{ ts: string; kind: string; label: string; ref?: string | undefined }> = []
  for (const a of recentApproved.data || []) {
    const prop = (a as any).properties
    history.push({
      ts: (a as any).approved_at,
      kind: 'approval',
      label: `אישור תיווך: ${prop?.title || ''}${prop?.city ? ' · ' + prop.city : ''}`,
      ref: (a as any).property_id ? `/properties/${(a as any).property_id}` : undefined,
    })
  }
  for (const m of recentOutreach.data || []) {
    history.push({
      ts: (m as any).created_at,
      kind: 'outreach',
      label: `נשלחה פנייה ראשונה (${(m as any).template_name || 'template'})`,
      ref: (m as any).thread_id ? `/inbox/${(m as any).thread_id}` : undefined,
    })
  }
  for (const r of recentRenters.data || []) {
    const name = [(r as any).first_name, (r as any).last_name].filter(Boolean).join(' ')
    history.push({
      ts: (r as any).created_at,
      kind: 'renter',
      label: `שוכר חדש הצטרף למאגר: ${name}`,
      ref: `/renters/${(r as any).id}`,
    })
  }
  for (const a of recentHandoffs.data || []) {
    const t = (a as any).type
    const label = t === 'handoff' ? 'בקשה להעברה לאדם' : t === 'closed_won' ? 'נסגרה בהצלחה' : `התראה: ${t}`
    history.push({
      ts: (a as any).created_at,
      kind: 'alert',
      label,
      ref: (a as any).thread_id ? `/inbox/${(a as any).thread_id}` : undefined,
    })
  }
  history.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))

  return NextResponse.json({
    kpis,
    history: history.slice(0, 12),
    needs_attention: { failed_messages: [] },
  })
}
