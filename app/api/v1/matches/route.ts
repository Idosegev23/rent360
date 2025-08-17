import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../lib/auth'
import { computeMatchScore, Weights } from '../../../../lib/matching'

const DEFAULT_WEIGHTS: Weights = {
  price: 0.3,
  location: 0.25,
  rooms: 0.2,
  amenities: 0.15,
  moveIn: 0.1
}

export async function GET(request: NextRequest) {
  try {
    const cookie = request.cookies.get('sb-access-token')?.value
    const uid = getUserIdFromSupabaseCookie(cookie)
    
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const sb = supabaseService()
    const { data: user } = await sb
      .from('users')
      .select('org_id')
      .eq('id', uid)
      .maybeSingle()

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Get all leads and properties for this org
    const [{ data: leads }, { data: properties }] = await Promise.all([
      sb.from('leads')
        .select('*')
        .eq('org_id', user.org_id)
        .in('status', ['new', 'active', 'contacted']), // Include all relevant statuses
      sb.from('properties')
        .select('*')
        .eq('org_id', user.org_id)
        .eq('is_active', true)
    ])

    if (!leads || !properties) {
      return NextResponse.json({ 
        matches: [],
        debug: {
          leadsCount: leads?.length || 0,
          propertiesCount: properties?.length || 0,
          message: 'No leads or properties found'
        }
      })
    }

    // Add debug info about what we found
    console.log(`Found ${leads.length} leads and ${properties.length} properties for org ${user.org_id}`)
    if (leads.length === 0) {
      console.log('No leads found - check lead status values')
    }
    if (properties.length === 0) {
      console.log('No properties found - check is_active values')
    }

    // Calculate matches for all combinations
    const matches = []
    
    for (const lead of leads) {
      for (const property of properties) {
        const matchResult = computeMatchScore(lead, property, DEFAULT_WEIGHTS)
        
        matches.push({
          lead_id: lead.id,
          property_id: property.id,
          lead: {
            id: lead.id,
            full_name: lead.full_name,
            phone: lead.phone,
            budget_min: lead.budget_min,
            budget_max: lead.budget_max,
            preferred_cities: lead.preferred_cities,
            preferred_rooms: lead.preferred_rooms,
            required_fields: lead.required_fields,
            move_in_from: lead.move_in_from
          },
          property: {
            id: property.id,
            title: property.title,
            city: property.city,
            neighborhood: property.neighborhood,
            price: property.price,
            rooms: property.rooms,
            sqm: property.sqm,
            amenities: property.amenities,
            images: property.images,
            available_from: property.available_from
          },
          score: matchResult.score,
          percentage: matchResult.percentage,
          isDisqualified: matchResult.isDisqualified,
          disqualifyingReasons: matchResult.disqualifyingReasons,
          breakdown: matchResult.breakdown,
          reasons: matchResult.reasons
        })
      }
    }

    // Sort by score (highest first), but disqualified ones go to bottom
    matches.sort((a, b) => {
      if (a.isDisqualified && !b.isDisqualified) return 1
      if (!a.isDisqualified && b.isDisqualified) return -1
      return b.score - a.score
    })

    return NextResponse.json({ 
      matches, 
      total: matches.length,
      debug: {
        leadsCount: leads.length,
        propertiesCount: properties.length,
        totalCombinations: leads.length * properties.length,
        qualifiedMatches: matches.filter(m => !m.isDisqualified).length,
        disqualifiedMatches: matches.filter(m => m.isDisqualified).length
      }
    })

  } catch (error) {
    console.error('Error fetching matches:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}