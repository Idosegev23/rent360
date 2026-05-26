import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../lib/supabase'
import { normalizeCity } from '../../../../lib/data/normalize-property'

/**
 * Public endpoint — returns distinct neighborhood names that appear in active
 * properties, optionally filtered to a set of cities. Powers the autocomplete
 * in the renter questionnaire (no auth required) and the property filter UI.
 *
 *   GET /api/v1/neighborhoods                  → all known neighborhoods
 *   GET /api/v1/neighborhoods?cities=חיפה,נשר  → only within those cities
 *
 * Returns `{ neighborhoods: [{ name, city, count }, ...] }` sorted by frequency.
 * Counts come from the underlying properties so the most populated areas
 * surface first in the autocomplete.
 */
export async function GET(req: NextRequest) {
  const sb = supabaseService()
  const citiesParam = req.nextUrl.searchParams.get('cities')
  const cities = citiesParam
    ? citiesParam.split(',').map(s => normalizeCity(s.trim())).filter((s): s is string => !!s)
    : []

  let query = sb
    .from('properties')
    .select('city, neighborhood')
    .eq('is_active', true)
    .not('neighborhood', 'is', null)
    .neq('neighborhood', '')
    // 5,000 is plenty for autocomplete — distinct dedup happens client-side.
    .limit(5000)

  if (cities.length > 0) query = query.in('city', cities)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: { code: 'QUERY_FAILED', message: error.message } }, { status: 500 })
  }

  // Aggregate: count per (city, neighborhood) pair.
  const bucket = new Map<string, { name: string; city: string; count: number }>()
  for (const row of data || []) {
    const name = (row.neighborhood || '').trim()
    const city = (row.city || '').trim()
    if (!name || !city) continue
    const key = `${city}::${name}`
    const existing = bucket.get(key)
    if (existing) existing.count += 1
    else bucket.set(key, { name, city, count: 1 })
  }

  const neighborhoods = Array.from(bucket.values()).sort((a, b) => b.count - a.count)
  return NextResponse.json({ neighborhoods })
}
