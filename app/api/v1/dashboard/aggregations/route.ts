import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../lib/auth'

export async function GET(){
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if(!userId) return NextResponse.json({ error:{ code:'NO_SESSION' } }, { status: 401 })
  
  const sb = supabaseService()

  // Resolve org
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if(!user) return NextResponse.json({ error:{ code:'NO_USER' } }, { status: 401 })
  const orgId = user.org_id

  try {
    // Get all properties data
    const { data: properties, error: propsError } = await sb
      .from('properties')
      .select('city, price, sqm, is_active, created_at, source')
      .eq('org_id', orgId)
      .limit(5000)

    if(propsError) throw propsError

    // Calculate aggregations
    const propertiesData = properties || []
    
    // Properties by city
    const cityMap = new Map<string, number>()
    propertiesData.forEach(p => {
      const city = p.city || 'לא צוין'
      cityMap.set(city, (cityMap.get(city) || 0) + 1)
    })
    const properties_by_city = Array.from(cityMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)

    // Price ranges
    const priceRanges = [
      { range: '0-3,000', count: 0 },
      { range: '3,000-5,000', count: 0 },
      { range: '5,000-7,000', count: 0 },
      { range: '7,000+', count: 0 }
    ]
    
    propertiesData.forEach(p => {
      const price = p.price || 0
      if (price <= 3000) priceRanges[0]!.count++
      else if (price <= 5000) priceRanges[1]!.count++
      else if (price <= 7000) priceRanges[2]!.count++
      else priceRanges[3]!.count++
    })

    // Stats
    const properties_total = propertiesData.length
    const active_properties = propertiesData.filter(p => p.is_active).length
    const brokerage_properties = propertiesData.filter(p => p.source && p.source.includes('יד 2 תיווך')).length
    const direct_properties = properties_total - brokerage_properties
    const avg_price = properties_total > 0 
      ? Math.round(propertiesData.reduce((sum, p) => sum + (p.price || 0), 0) / properties_total)
      : 0
    const avg_size = properties_total > 0 
      ? Math.round(propertiesData.reduce((sum, p) => sum + (p.sqm || 0), 0) / properties_total)
      : 0

    // Weekly activity (last 7 days)
    const now = new Date()
    const weekly_activity = []
    const dayNames = ['ש', 'א', 'ב', 'ג', 'ד', 'ה', 'ו']
    
    for(let i = 6; i >= 0; i--) {
      const date = new Date(now)
      date.setDate(date.getDate() - i)
      const dayStart = new Date(date)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(date)
      dayEnd.setHours(23, 59, 59, 999)
      
      const propertiesCount = propertiesData.filter(p => {
        const created = new Date(p.created_at)
        return created >= dayStart && created <= dayEnd
      }).length

      weekly_activity.push({
        day: dayNames[date.getDay()],
        properties: propertiesCount,
        leads: 0, // Could add leads data here
        messages: 0 // Could add messages data here
      })
    }

    return NextResponse.json({
      properties_by_city,
      price_ranges: priceRanges,
      properties_total,
      active_properties,
      brokerage_properties,
      direct_properties,
      avg_price,
      avg_size,
      weekly_activity
    })

  } catch (error: any) {
    console.error('Error fetching dashboard analytics:', error)
    return NextResponse.json({ 
      error: { code: 'DB', message: error.message } 
    }, { status: 500 })
  }
}
