/**
 * Property data normalizer.
 *
 * The יד2 / MLS scrapers ship dirty data into our properties table:
 *   - city often carries a " - מגורים" suffix (e.g. "חיפה - מגורים")
 *   - the whole "<street> <number> קומה <floor> <actual nbh>" string lands
 *     in BOTH neighborhood and street, leaving floor empty
 *
 * Historical rows were repaired by a one-off migration. This module is the
 * forward-going equivalent: any code that ingests or approves a property
 * should pass it through `normalizePropertyData()` so the same cleaning
 * happens at write time. Keep this in sync with the migration's regexes —
 * if the scraper format changes, fix both here and in the parser.
 */

export type RawPropertyFields = {
  city?: string | null
  neighborhood?: string | null
  street?: string | null
  floor?: number | null
}

export type NormalizedPropertyFields = {
  city: string | null
  neighborhood: string | null
  street: string | null
  floor: number | null
}

const FLOOR_REGEX = /קומה\s+(\d+)/

/** Strip the " - מגורים" suffix that scrapers append to city names. */
export function normalizeCity(city: string | null | undefined): string | null {
  if (!city) return null
  return city.replace(/\s*-\s*מגורים\s*$/, '').trim() || null
}

/**
 * Split a scraped neighborhood field like
 *   "ברל כצנלסון 36 קומה 1 נווה שאנן"
 * into { street: "ברל כצנלסון 36", floor: 1, neighborhood: "נווה שאנן" }.
 *
 * Returns the input unchanged if the "קומה <n>" marker is absent.
 */
export function parseScrapedNeighborhood(neighborhood: string | null | undefined): {
  street: string | null
  floor: number | null
  neighborhood: string | null
} {
  if (!neighborhood) return { street: null, floor: null, neighborhood: null }
  const match = neighborhood.match(/^(.+?)\s+קומה\s+(\d+)\s+(.+)$/)
  if (!match) {
    return { street: null, floor: null, neighborhood: neighborhood.trim() || null }
  }
  return {
    street: match[1]!.trim(),
    floor: parseInt(match[2]!, 10),
    neighborhood: match[3]!.trim(),
  }
}

/**
 * Full property normalizer. Pass it the raw scraped fields; receive a
 * cleaned set ready for upsert. Existing non-null floors are preserved
 * (the parsed one only fills in when floor was missing).
 */
export function normalizePropertyData(raw: RawPropertyFields): NormalizedPropertyFields {
  const city = normalizeCity(raw.city ?? null)

  const nbh = raw.neighborhood?.trim() ?? null
  // Only run the scraped-neighborhood parser when it looks like the
  // concatenated format. Otherwise treat the neighborhood as-is so we
  // don't mangle clean values like "הדר מרכז" or "רמת בן גוריון".
  if (nbh && FLOOR_REGEX.test(nbh)) {
    const parsed = parseScrapedNeighborhood(nbh)
    return {
      city,
      neighborhood: parsed.neighborhood,
      street: parsed.street ?? raw.street ?? null,
      floor: raw.floor ?? parsed.floor,
    }
  }

  return {
    city,
    neighborhood: nbh,
    street: raw.street?.trim() || null,
    floor: raw.floor ?? null,
  }
}
