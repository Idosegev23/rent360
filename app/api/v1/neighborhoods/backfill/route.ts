import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { extractCanonicalNeighborhood } from '../../../../../lib/data/known-neighborhoods'
import { normalizeCity } from '../../../../../lib/data/normalize-property'

/**
 * One-shot backfill: walks every property and re-extracts the canonical
 * neighborhood name using the live TS directory + matcher. Mirrors what
 * `lib/data/normalize-property.ts` would do at write time, but for the
 * 10k+ historical rows. Guarded by CRON_SECRET so it's safe to leave
 * deployed.
 *
 *   - If extractCanonicalNeighborhood finds a match → set the canonical
 *     spelling and (when the street was empty or duplicated the
 *     neighborhood) the prefix becomes the street.
 *   - If no match and the value looks like an address (contains digits)
 *     → drop the neighborhood (set to NULL).
 *   - If no match and the value doesn't look like an address → leave it
 *     alone. Could be a real neighborhood not yet in our directory.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })
  }

  const sb = supabaseService()

  // Paginate through the properties table — large dataset.
  const PAGE_SIZE = 1000
  let from = 0
  let totalScanned = 0
  let canonicalised = 0
  let nulled = 0
  let leftAlone = 0

  for (;;) {
    const { data: rows, error } = await sb
      .from('properties')
      .select('id, city, neighborhood, street')
      .not('neighborhood', 'is', null)
      .neq('neighborhood', '')
      .order('id')
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      return NextResponse.json({ error: { code: 'QUERY_FAILED', message: error.message } }, { status: 500 })
    }
    if (!rows || rows.length === 0) break
    totalScanned += rows.length

    // Compute updates for the page.
    type Update = { id: string; neighborhood: string | null; street?: string | null }
    const updates: Update[] = []
    for (const row of rows) {
      const normalizedCity = normalizeCity(row.city)
      const result = extractCanonicalNeighborhood(row.neighborhood, normalizedCity)

      if (result.neighborhood) {
        const wantStreet =
          !row.street || row.street === row.neighborhood
            ? result.prefix
            : row.street
        if (result.neighborhood !== row.neighborhood || wantStreet !== row.street) {
          updates.push({ id: row.id, neighborhood: result.neighborhood, street: wantStreet })
        }
        canonicalised += 1
      } else if (/\d/.test(row.neighborhood)) {
        // Looks like an address that doesn't end in a known neighborhood — drop.
        updates.push({ id: row.id, neighborhood: null })
        nulled += 1
      } else {
        leftAlone += 1
      }
    }

    // Apply updates one at a time (Supabase doesn't support multi-row UPDATE
    // with different values via a single API call). 1000/page → manageable.
    for (const u of updates) {
      const payload: { neighborhood: string | null; street?: string | null } = { neighborhood: u.neighborhood }
      if ('street' in u) payload.street = u.street ?? null
      await sb.from('properties').update(payload).eq('id', u.id)
    }

    if (rows.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return NextResponse.json({
    ok: true,
    total_scanned: totalScanned,
    canonicalised,
    nulled,
    left_alone: leftAlone,
  })
}
