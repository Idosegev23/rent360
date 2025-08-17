import { cookies } from 'next/headers'
import { NextResponse, NextRequest } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../lib/auth'

function aggregate<T>(rows: T[], getLabel: (r: T) => string | number | null | undefined) {
  const map = new Map<string, number>()
  for (const r of rows) {
    const labelRaw = getLabel(r)
    const label = labelRaw === null || labelRaw === undefined || labelRaw === '' ? 'לא צוין' : String(labelRaw)
    map.set(label, (map.get(label) || 0) + 1)
  }
  return Array.from(map.entries()).map(([label, value]) => ({ label, value }))
}

export async function GET(req: NextRequest){
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if(!userId) return NextResponse.json({ error:{ code:'NO_SESSION' } }, { status: 401 })
  const sb = supabaseService()
  const { searchParams } = new URL(req.url)
  const entity = searchParams.get('entity') || 'properties' // properties|leads|messages
  const dim = searchParams.get('dim') || 'city' // city|rooms|status|preferred_city|preferred_rooms
  const range = searchParams.get('range') || '7d' // 7d|30d

  const since = new Date(Date.now() - (range==='30d' ? 30 : 7)*24*60*60*1000).toISOString()

  // Resolve org
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if(!user) return NextResponse.json({ error:{ code:'NO_USER' } }, { status: 401 })
  const orgId = user.org_id

  if(entity === 'properties'){
    const { data, error } = await sb.from('properties').select('city, rooms, created_at').eq('org_id', orgId).gte('created_at', since).limit(5000)
    if(error) return NextResponse.json({ error:{ code:'DB', message: error.message } }, { status: 500 })
    if(dim === 'city') return NextResponse.json({ series: aggregate(data || [], r => (r as any).city).slice(0,10) })
    if(dim === 'rooms') return NextResponse.json({ series: aggregate(data || [], r => (r as any).rooms).slice(0,12) })
  }

  if(entity === 'leads'){
    const { data, error } = await sb.from('leads').select('preferred_cities, preferred_rooms, created_at').eq('org_id', orgId).gte('created_at', since).limit(5000)
    if(error) return NextResponse.json({ error:{ code:'DB', message: error.message } }, { status: 500 })
    if(dim === 'preferred_city'){
      const flat: any[] = []
      for(const r of data || []){
        const arr = (r as any).preferred_cities as string[] | null
        if(Array.isArray(arr)) arr.forEach(c => flat.push({ city: c }))
      }
      return NextResponse.json({ series: aggregate(flat, r => (r as any).city).slice(0,10) })
    }
    if(dim === 'preferred_rooms') return NextResponse.json({ series: aggregate(data || [], r => (r as any).preferred_rooms).slice(0,12) })
  }

  if(entity === 'messages'){
    const { data, error } = await sb.from('messages').select('status, created_at').eq('org_id', orgId).gte('created_at', since).limit(5000)
    if(error) return NextResponse.json({ error:{ code:'DB', message: error.message } }, { status: 500 })
    if(dim === 'status') return NextResponse.json({ series: aggregate(data || [], r => (r as any).status) })
  }

  return NextResponse.json({ series: [] })
}
