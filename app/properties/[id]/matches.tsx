import { supabaseService } from '../../../lib/supabase'
import { cookies } from 'next/headers'
import { getUserIdFromSupabaseCookie } from '../../../lib/auth'
import MatchesListClient from '../../../components/matches/MatchesListClient'

export default async function PropertyMatches({ propertyId }: { propertyId: string }){
  const cookie = cookies().get('sb-access-token')?.value
  const uid = getUserIdFromSupabaseCookie(cookie)
  if(!uid) return null
  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', uid).maybeSingle()
  if(!user) return null
  const { data } = await sb
    .from('matches')
    .select('id, score, lead_id, status')
    .eq('org_id', user.org_id)
    .eq('property_id', propertyId)
    .order('score', { ascending: false })
    .limit(20)

  if(!data || data.length===0){
    return <div className="text-sm text-brand-inkMuted">אין עדיין התאמות לנכס הזה.</div>
  }
  // Fetch property and leads to compute missing required
  const [{ data: prop }, { data: leads }] = await Promise.all([
    sb.from('properties').select('id, amenities, city, neighborhood, price, rooms, sqm, link, title').eq('org_id', user.org_id).eq('id', propertyId).maybeSingle(),
    sb.from('leads').select('id, full_name, first_name, last_name, phone, required_fields').eq('org_id', user.org_id).in('id', data.map(m=>m.lead_id))
  ])
  const leadMap = new Map((leads||[]).map((l:any)=>[l.id, l]))
  const items = data.map((m:any) => {
    const l = leadMap.get(m.lead_id) || {}
    const req: Record<string, boolean> = l.required_fields || {}
    const missing: string[] = []
    for(const [k, v] of Object.entries(req)){
      if(v){
        const hasAmen = !!prop?.amenities?.[k] || !!(prop as any)?.[k]
        if(!hasAmen) missing.push(k)
      }
    }
    return { ...m, lead: l, property: prop, missingRequired: missing }
  })
  return <MatchesListClient items={items} propertyId={propertyId} />
}
