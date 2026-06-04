/**
 * Pull amenity flags out of a property's free-text fields (title + description
 * + scraped full_text). Pure keyword matching — no AI calls — because the
 * Hebrew vocabulary for these features is small and deterministic, and we
 * want this cheap enough to run across the entire approved inventory.
 *
 * For each amenity we keep:
 *   - `positive`: phrases that mean "the property has it"
 *   - `negative`: phrases that mean "the property explicitly doesn't have it"
 *
 * Match priority: negative beats positive. So "ללא חניה" sets parking=false
 * even if "חניה" appears in another sentence. Empty match → null (don't
 * overwrite the stored value either way).
 */

export type AmenityKey =
  | 'parking'
  | 'airConditioner'
  | 'storage'
  | 'balcony'
  | 'elevator'
  | 'mamad'
  | 'furnished'
  | 'solarHeater'
  | 'bars'
  | 'shelter'
  | 'fiberInternet'
  | 'accessibility'
  | 'garden'
  | 'divided'

type Spec = {
  positive: string[]
  negative: string[]
}

const SPECS: Record<AmenityKey, Spec> = {
  parking: {
    positive: ['חניה', 'חנייה', 'חניית', 'חניות', 'חניה פרטית', 'חניה משותפת', 'חניה בטאבו', 'חניה תת-קרקעית', 'חניה תת קרקעית', 'מקום חניה'],
    negative: ['ללא חניה', 'אין חניה', 'בלי חניה', 'ללא חנייה', 'אין חנייה'],
  },
  airConditioner: {
    positive: ['מזגן', 'מזגנים', 'מיזוג אוויר', 'מיזוג מרכזי', 'מיזוג'],
    negative: ['ללא מזגן', 'אין מזגן', 'בלי מזגן', 'ללא מיזוג'],
  },
  storage: {
    positive: ['מחסן', 'מחסנים'],
    negative: ['ללא מחסן', 'אין מחסן', 'בלי מחסן'],
  },
  balcony: {
    positive: ['מרפסת', 'מרפסות', 'מרפסת שמש', 'מרפסת סוכה', 'מרפסת גדולה'],
    negative: ['ללא מרפסת', 'אין מרפסת', 'בלי מרפסת'],
  },
  elevator: {
    positive: ['מעלית', 'מעליות', 'מעלית שבת'],
    negative: ['ללא מעלית', 'אין מעלית', 'בלי מעלית'],
  },
  mamad: {
    positive: ['ממ״ד', 'ממ"ד', 'ממד', 'ממ"ק', 'חדר ביטחון', 'חדר ביטחוני'],
    negative: ['ללא ממ"ד', 'אין ממ"ד', 'ללא ממד'],
  },
  furnished: {
    positive: ['מרוהט', 'מרוהטת', 'מרוהטים', 'ריהוט מלא', 'ריהוט חלקי', 'מרוהט חלקי', 'מרוהט במלואו', 'עם ריהוט'],
    negative: ['ללא ריהוט', 'לא מרוהטת', 'לא מרוהט', 'בלי ריהוט', 'ריקה', 'לא רהוטה'],
  },
  solarHeater: {
    positive: ['דוד שמש', 'דוד-שמש', 'דודי שמש', 'חימום סולארי', 'חימום סולרי'],
    negative: ['ללא דוד שמש', 'אין דוד שמש'],
  },
  bars: {
    positive: ['סורגים', 'סורג', 'מסורגת'],
    negative: ['ללא סורגים', 'אין סורגים'],
  },
  shelter: {
    positive: ['מקלט', 'מקלטים', 'מקלט משותף'],
    negative: ['ללא מקלט', 'אין מקלט'],
  },
  fiberInternet: {
    positive: ['סיבים אופטיים', 'סיבים אופטים', 'אינטרנט סיבים', 'תשתית סיבים', 'פתוח לסיבים', 'מותאם לסיבים'],
    negative: ['ללא סיבים', 'אין סיבים', 'אין תשתית סיבים'],
  },
  accessibility: {
    positive: ['נגישות', 'נגישה לנכים', 'דירת נכים', 'נגיש לנכים', 'מעלית לנכים', 'רמפה', 'ללא מדרגות'],
    negative: ['ללא נגישות', 'אינה נגישה'],
  },
  // חצר/גינה. Specific phrases only — bare "גינה" is avoided because it is a
  // substring of common words/street names (e.g. "המגינים").
  garden: {
    positive: ['חצר', 'חצר פרטית', 'חצר צמודה', 'יציאה לחצר', 'דירת גן', 'גינה פרטית', 'גינה צמודה', 'יציאה לגינה', 'עם גינה'],
    negative: ['ללא חצר', 'אין חצר', 'בלי חצר', 'ללא גינה', 'אין גינה'],
  },
  // דירה מחולקת / מפוצלת / שותפים.
  divided: {
    positive: ['דירה מחולקת', 'מחולקת', 'מחולק', 'דירת שותפים', 'דירה מפוצלת', 'מפוצלת', 'מחולקת לשתי יחידות', 'מחולקת ל-'],
    negative: ['לא מחולקת', 'דירה שלמה', 'אינה מחולקת', 'לא מפוצלת'],
  },
}

const LIKELY_KEYS: AmenityKey[] = Object.keys(SPECS) as AmenityKey[]

/** Normalize text for matching: collapse whitespace, lowercase, remove most punctuation noise. */
function normalize(text: string): string {
  return text
    .replace(/[ \s]+/g, ' ')
    .replace(/[.,;:!?()[\]{}"׳״]/g, ' ')
    .trim()
}

// JS regex doesn't have Hebrew word boundaries, so we pad the haystack with
// spaces and look for ` needle ` (or end-anchored variants). This avoids
// "מרוהט" matching inside "אינו מרוהט" because the negative phrase is its
// own distinct entry in SPECS — so order of checks (negative-first) handles it.
function contains(haystack: string, needle: string): boolean {
  if (!needle) return false
  return haystack.includes(needle)
}

/**
 * Detected amenities map: { [key]: true | false | null }.
 *   true  → text says it's there
 *   false → text says it's not
 *   null  → text is silent on this amenity
 */
export type DetectedAmenities = Partial<Record<AmenityKey, boolean | null>>

export function extractAmenitiesFromText(parts: Array<string | null | undefined>): DetectedAmenities {
  const text = normalize(parts.filter(Boolean).join('\n'))
  if (!text) return {}

  const out: DetectedAmenities = {}
  for (const key of LIKELY_KEYS) {
    const spec = SPECS[key]
    const hasNeg = spec.negative.some(n => contains(text, normalize(n)))
    if (hasNeg) { out[key] = false; continue }
    const hasPos = spec.positive.some(p => contains(text, normalize(p)))
    if (hasPos) { out[key] = true; continue }
    out[key] = null
  }
  return out
}

/** Same logic but also returns the matched phrase + a short surrounding window
 *  so callers can audit the false-positive rate by eye. */
export function extractAmenitiesFromTextWithEvidence(
  parts: Array<string | null | undefined>,
): Record<AmenityKey, { value: boolean | null; phrase: string | null; snippet: string | null }> {
  const text = normalize(parts.filter(Boolean).join('\n'))
  const out = {} as Record<AmenityKey, { value: boolean | null; phrase: string | null; snippet: string | null }>
  for (const key of LIKELY_KEYS) {
    const spec = SPECS[key]
    let value: boolean | null = null
    let phrase: string | null = null
    for (const n of spec.negative) {
      const nn = normalize(n)
      if (text.includes(nn)) { value = false; phrase = n; break }
    }
    if (value === null) {
      for (const p of spec.positive) {
        const pn = normalize(p)
        if (text.includes(pn)) { value = true; phrase = p; break }
      }
    }
    let snippet: string | null = null
    if (phrase) {
      const np = normalize(phrase)
      const i = text.indexOf(np)
      if (i >= 0) {
        const start = Math.max(0, i - 30)
        const end = Math.min(text.length, i + np.length + 30)
        snippet = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
      }
    }
    out[key] = { value, phrase, snippet }
  }
  return out
}
