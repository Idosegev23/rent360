/**
 * Canonical neighborhood directory for Haifa + Krayot.
 *
 * Sources:
 *   - User-provided official list for Haifa (split by region: Carmel, Hadar,
 *     Neve Sha'anan, west coast).
 *   - Observed inventory data for the Krayot cities (יד2/MLS).
 *
 * Used in two places that must stay in sync:
 *   1. lib/data/normalize-property.ts — extracts the canonical neighborhood
 *      from noisy scraper strings at write time.
 *   2. Historical cleanup migration — same logic in SQL, run once.
 *
 * Each list is sorted longest-first when consumed so that "רוממה החדשה"
 * matches before "רוממה" and "הדר עליון" before "הדר".
 */

const RAW_PER_CITY: Record<string, string[]> = {
  'חיפה': [
    // Carmel
    'מרכז כרמל',
    'אחוזה',
    'כרמליה',
    'רוממה החדשה',
    'רוממה הישנה',
    'דניה',
    'הוד הכרמל',
    'כרמל צרפתי',
    'כבביר',
    'ורדיה',
    'רמת גולדה',
    'רמת אלמוגי',
    'רמת אשכול',
    'רמת אלון',
    'סביוני דניה',
    'סביוני הכרמל',
    // Neve Sha'anan
    'נווה שאנן',
    'רמת רמז',
    'רמת חן',
    'רמת ספיר',
    'רמת זמר',
    'יזרעאליה',
    // Hadar / lower city
    'הדר עליון',
    'הדר מרכז',
    'הדר תחתון',
    'הדר הכרמל',
    'העיר התחתית',
    'ואדי ניסנס',
    'ואדי ניסנאס',
    'ואדי סאליב',
    'חליסה',
    'תל עמל',
    'נווה יוסף',
    // West Haifa
    'קריית אליעזר',
    'קריית אליהו',
    'בת גלים',
    'שער העלייה',
    'שער העליה',
    'נווה דוד',
    'קריית שפרינצק',
    'שפרינצק',
    'רמת הנשיא',
    'עין הים',
    // Other documented sub-areas
    'כרמל מערבי',
    'נווה פז',
    'כבירים',
    'מושבה גרמנית',
    'גאולה',
    'גבעת אורנים',
    'גבעת זמר',
    'גבעת דאונס',
    'מת"מ',
    'נאות פרס',
    'שוק תלפיות',
    'סטלה מאריס',
    'שמבור',
    'עבאס',
    'נווה גנים',
    'רמת בגין',
    'רמת בן גוריון',
    'רמת הדר',
    'רמת התשבי',
    "רמת ויז'ניץ",
    'רמת שאול',
    'המיימוני',
    'זיו',
    'חוף הכרמל',
    "מרכז מרכזי - שד' קיש",
    'שער פלמר',
  ],
  'קרית ביאליק': [
    'ביאליק דרום',
    'ביאליק הוותיקה',
    'נאות אפק',
    'סביניה',
    'צור שלום',
    'קריית שמריהו',
    'אפק',
    'הפרפר',
    'מרכז',
  ],
  'קרית מוצקין': [
    'מוצקין הוותיקה',
    'נווה אביבים',
    'משכנות האומנים',
    'לב מוצקין',
  ],
  'קרית אתא': [
    'גבעת הרקפות',
    'גבעת אלונים',
    'קריית בנימין',
    'קריית פרוסטיג',
    "גבעה א'",
    'גבעת טל',
    'גבעת רם',
    'נווה הדסה',
    'נווה אברהם',
    'נווה חן',
    'בית וגן',
    'אברמסקי',
    'בן גוריון',
    'שביט',
    'מרכז',
  ],
  'קרית ים': [
    "קריית ים ד'",
    "קריית ים ג'",
    "קריית ים א'",
    "קריית ים ב'",
    'סביוני ים',
    'פסגות ים',
    'בנה ביתך',
    'אלמוגים',
    'צבא קבע',
    'גלי ים',
  ],
  // Sub-cities of Haifa that are themselves divided into neighborhoods.
  'קריית חיים': [
    'קריית חיים מזרחית',
    'קריית חיים מערבית',
    'קריית שמואל',
  ],
}

// Sort each city's list by length descending so the suffix match is greedy.
export const KNOWN_NEIGHBORHOODS_PER_CITY: Record<string, string[]> =
  Object.fromEntries(
    Object.entries(RAW_PER_CITY).map(([city, list]) => [
      city,
      [...list].sort((a, b) => b.length - a.length),
    ])
  )

// Flat set of every known name across all cities, longest-first. Used as a
// fallback when the property's city isn't one we explicitly mapped.
export const ALL_KNOWN_NEIGHBORHOODS: string[] = Array.from(
  new Set(Object.values(RAW_PER_CITY).flat())
).sort((a, b) => b.length - a.length)

/**
 * Hebrew spelling variants we collapse for matching. The biggest one is the
 * "Krayot prefix" — "קריית" (two yods) vs "קרית" (one yod) — which appears
 * inconsistently across scrapers, the questionnaire, and admin entries.
 * Normalize before any equality/suffix check.
 */
function normalizeForMatch(s: string): string {
  return s
    .replace(/קריית/g, 'קרית')
    .replace(/קרייית/g, 'קרית')
    .toLowerCase()
}

/**
 * Try to extract a canonical neighborhood name from a noisy string like
 * "אורן 13 רוממה החדשה" → "רוממה החדשה".
 *
 *   - If the whole string is already a canonical name → returns it as-is.
 *   - If the string ends with a known neighborhood (space-separated)
 *     → returns the neighborhood and the prefix (which becomes the street).
 *   - Otherwise → returns nulls (caller decides whether to keep the raw value
 *     or drop it).
 *
 * The returned neighborhood is the canonical spelling from our directory,
 * so downstream consumers see consistent text regardless of the input.
 */
export function extractCanonicalNeighborhood(
  raw: string | null | undefined,
  city?: string | null
): { neighborhood: string | null; prefix: string | null } {
  if (!raw) return { neighborhood: null, prefix: null }
  const cleaned = raw.trim()
  if (!cleaned) return { neighborhood: null, prefix: null }
  const cleanedNorm = normalizeForMatch(cleaned)

  // Try the property's city's list first (also matching yod variants of the
  // city key), then fall back to the global list. Dedupe so we don't
  // re-check the same name twice.
  const seen = new Set<string>()
  const candidates: string[] = []
  const normalizedCity = city ? normalizeForMatch(city) : undefined
  if (normalizedCity) {
    for (const [k, list] of Object.entries(KNOWN_NEIGHBORHOODS_PER_CITY)) {
      if (normalizeForMatch(k) === normalizedCity) {
        for (const name of list) {
          if (!seen.has(name)) { candidates.push(name); seen.add(name) }
        }
      }
    }
  }
  for (const name of ALL_KNOWN_NEIGHBORHOODS) {
    if (!seen.has(name)) { candidates.push(name); seen.add(name) }
  }

  // Word-level matching so the spelling normalization can't accidentally
  // chop the wrong character count off the raw string.
  const rawWords = cleaned.split(/\s+/).filter(Boolean)
  const rawWordsNorm = rawWords.map(normalizeForMatch)

  for (const name of candidates) {
    const nameWords = name.split(/\s+/).filter(Boolean)
    const nameWordsNorm = nameWords.map(normalizeForMatch)
    if (nameWords.length === 0 || nameWords.length > rawWords.length) continue
    const start = rawWords.length - nameWords.length
    let allMatch = true
    for (let i = 0; i < nameWords.length; i++) {
      if (rawWordsNorm[start + i] !== nameWordsNorm[i]) { allMatch = false; break }
    }
    if (!allMatch) continue

    // Self-duplication: "הדר עליון הדר עליון" → "הדר עליון" with no street.
    if (start === nameWords.length) {
      const head = rawWordsNorm.slice(0, nameWords.length).join(' ')
      const tail = rawWordsNorm.slice(start).join(' ')
      if (head === tail) return { neighborhood: name, prefix: null }
    }

    const prefix = rawWords.slice(0, start).join(' ').trim()
    return { neighborhood: name, prefix: prefix || null }
  }

  return { neighborhood: null, prefix: null }
}
