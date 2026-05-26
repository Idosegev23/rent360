/**
 * Property data normalizer.
 *
 * The יד2 / MLS scrapers ship dirty data into our properties table:
 *   - city often carries a " - מגורים" suffix (e.g. "חיפה - מגורים")
 *   - the whole "<street> <number> קומה <floor> <actual nbh>" string lands
 *     in BOTH neighborhood and street, leaving floor empty
 *   - some rows have "<street> <num> <nbh>" (no floor) — same problem
 *
 * Two cleanup stages run in order:
 *   1. Strip " - מגורים" from city.
 *   2. Parse the scraped concatenation. First try the "<street> <num> קומה
 *      <floor> <nbh>" pattern (more specific). If that fails, fall back to
 *      `extractCanonicalNeighborhood` which suffix-matches against the
 *      known-neighborhoods directory.
 *
 * Historical rows are repaired by one-off migrations. This module is the
 * forward-going equivalent: any code that ingests or approves a property
 * should pass it through `normalizePropertyData()` so new data lands clean.
 * Keep this in sync with the migrations.
 */
import { extractCanonicalNeighborhood } from './known-neighborhoods'

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

  // 1) "<street> <num> קומה <floor> <nbh>" — the most common form, has its
  // own dedicated parser because it also gives us the floor.
  if (nbh && FLOOR_REGEX.test(nbh)) {
    const parsed = parseScrapedNeighborhood(nbh)
    // Even after the floor parse the trailing field could still be a
    // canonical neighborhood concatenated with something else — fall through
    // to the canonical extractor with whatever the parser left.
    const canonical = extractCanonicalNeighborhood(parsed.neighborhood, city)
    return {
      city,
      neighborhood: canonical.neighborhood ?? parsed.neighborhood,
      street: parsed.street ?? raw.street ?? null,
      floor: raw.floor ?? parsed.floor,
    }
  }

  // 2) No "קומה" marker — could be either clean ("הדר מרכז") or the
  // shorter dirty form ("אורן 13 רוממה החדשה"). Suffix-match against the
  // canonical directory. When we find a match, the prefix becomes the
  // street (unless the row already has a non-redundant street).
  if (nbh) {
    const canonical = extractCanonicalNeighborhood(nbh, city)
    if (canonical.neighborhood) {
      const incomingStreet = raw.street?.trim() || null
      const street =
        incomingStreet && incomingStreet !== nbh ? incomingStreet : canonical.prefix
      return {
        city,
        neighborhood: canonical.neighborhood,
        street,
        floor: raw.floor ?? null,
      }
    }
  }

  return {
    city,
    neighborhood: nbh,
    street: raw.street?.trim() || null,
    floor: raw.floor ?? null,
  }
}
