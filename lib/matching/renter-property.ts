/**
 * Renter ↔ Property matching engine.
 *
 * Pure function — no I/O, no side effects. Given a renter profile and a
 * property record, returns a normalized score (0-100) plus a per-dimension
 * breakdown so the UI can explain *why* a match scored what it scored.
 *
 * Two-level model:
 *   - **Hard disqualifiers** (pets/smokers conflict, city not in preferences)
 *     produce `isDisqualified=true` and score=0. We still store the row so
 *     the UI can show "אלה הסיבות שלא".
 *   - **Soft dimensions** (budget, rooms, sqm, floor, timing, area-fit) each
 *     return 0-1 weighted by the dimension's importance. Per-renter weights
 *     (renter.match_weights) override the defaults.
 *
 * Goal numbers are illustrative — tune after real data flows.
 */

export type RenterRow = {
  id: string
  preferred_cities: unknown            // jsonb — array of strings
  preferred_rooms: number | null
  rooms_flexible: boolean | null
  min_sqm: number | null
  floor_min: number | null
  floor_max: number | null
  top_floor_preference: string | null
  condition_preference: string | null
  budget_min: number | null
  budget_max: number | null
  budget_flexibility: number | null     // %, e.g. 10 means allow +10% over budget_max
  vaad_bayit_max: number | null
  arnona_max: number | null
  move_in_date: string | null           // ISO date
  move_in_flexible: boolean | null
  has_pets: boolean | null
  smokers: boolean | null
  household_size: number | null
  has_children: boolean | null
  children_count: number | null
  preferences: unknown                  // jsonb — { balcony: {level, min_sqm}, parking: {level, type}, elevator: {level}, ... }
  match_weights: unknown                // jsonb — overrides DEFAULT_WEIGHTS
}

export type PropertyRow = {
  id: string
  city: string
  neighborhood: string | null
  street: string | null
  address: string | null
  price: number | null
  rooms: number | null
  sqm: number | null
  floor: number | null
  amenities: unknown                    // jsonb — { elevator, parking, balcony, airConditioner, storage, mamad, ... }
  evacuation_date: string | null
  available_from: string | null
  pets_allowed: boolean | null
  smokers_allowed: boolean | null
  is_active: boolean
}

export const DEFAULT_WEIGHTS = {
  budget: 0.28,
  city: 0.22,
  rooms: 0.14,
  amenities: 0.18,    // balcony/parking/elevator/etc. — pulled from renter.preferences
  sqm: 0.08,
  floor: 0.03,
  timing: 0.04,
  demographic: 0.03,  // pets/smokers compatibility — partial when not DQ
} as const

export type Weights = { -readonly [K in keyof typeof DEFAULT_WEIGHTS]: number }
export type Dimension = keyof Weights

export type DimensionResult = {
  weight: number       // 0-1
  raw: number          // 0-1, before weight
  weighted: number     // raw * weight
  note: string         // human-readable Hebrew note for the UI
}

export type MatchResult = {
  score: number                                       // 0-100, weighted sum * 100
  isDisqualified: boolean
  disqualifyingReasons: string[]
  breakdown: Record<Dimension, DimensionResult>
  reasons: string[]                                   // top positive notes for UI summary
}

// --------- public API ------------------------------------------------------

export function scoreMatch(renter: RenterRow, property: PropertyRow): MatchResult {
  const weights = resolveWeights(renter.match_weights)
  const breakdown: Record<Dimension, DimensionResult> = {} as any
  const disqualifyingReasons: string[] = []

  // ----- Hard disqualifiers --------------------------------------------------
  // Only TRUE blockers (pet/smoker conflicts where the property explicitly forbids).
  // City mismatch is intentionally NOT a DQ — it shows up as a low city score
  // so admins can still see "close but wrong area" candidates with a low %.
  const propertyCities = toLowerSet([property.city, property.neighborhood])
  const preferredCities = toStringArray(renter.preferred_cities).map(s => s.toLowerCase())
  const hasCityList = preferredCities.length > 0

  if (renter.has_pets === true && property.pets_allowed === false) {
    disqualifyingReasons.push('השוכר עם חיות מחמד אבל הנכס לא מאפשר חיות')
  }

  if (renter.smokers === true && property.smokers_allowed === false) {
    disqualifyingReasons.push('השוכר מעשן אבל הנכס לא מאפשר עישון')
  }

  // ----- Soft dimensions -----------------------------------------------------
  breakdown.budget = scoreBudget(renter, property, weights.budget)
  breakdown.city = scoreCity(renter, property, weights.city, hasCityList, preferredCities, propertyCities)
  breakdown.rooms = scoreRooms(renter, property, weights.rooms)
  breakdown.amenities = scoreAmenities(renter, property, weights.amenities)
  breakdown.sqm = scoreSqm(renter, property, weights.sqm)
  breakdown.floor = scoreFloor(renter, property, weights.floor)
  breakdown.timing = scoreTiming(renter, property, weights.timing)
  breakdown.demographic = scoreDemographic(renter, property, weights.demographic)

  const isDisqualified = disqualifyingReasons.length > 0
  const weightedSum = Object.values(breakdown).reduce((s, d) => s + d.weighted, 0)
  const score = isDisqualified ? 0 : Math.round(weightedSum * 100)

  // Top positive notes — for the UI summary line
  const reasons = isDisqualified
    ? []
    : Object.values(breakdown)
        .filter(d => d.raw >= 0.75)
        .sort((a, b) => b.weighted - a.weighted)
        .slice(0, 3)
        .map(d => d.note)

  return { score, isDisqualified, disqualifyingReasons, breakdown, reasons }
}

// --------- internals -------------------------------------------------------

function resolveWeights(raw: unknown): Weights {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_WEIGHTS }
  const r = raw as Record<string, unknown>

  // Legacy shape from the renter questionnaire:
  //   { rooms, budget, location, nice_to_have, deal_breakers } summing ~100.
  // Translate to the engine's 8-dimension shape. Without this, only `budget`
  // and `rooms` survived the key lookup and renormalization crushed every
  // other dimension to <1% — so city/amenities mismatches barely moved the
  // score, which is why a wrong-city + missing-balcony property still scored 99.
  const hasLegacy = (
    typeof r.location === 'number' ||
    typeof r.nice_to_have === 'number' ||
    typeof r.deal_breakers === 'number'
  )
  if (hasLegacy) return translateLegacyWeights(r)

  const out: Weights = { ...DEFAULT_WEIGHTS }
  for (const k of Object.keys(DEFAULT_WEIGHTS) as Dimension[]) {
    const v = r[k]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v
  }
  // Re-normalize so total stays 1 (otherwise weights from renter could shift scale).
  const total = Object.values(out).reduce((s, x) => s + x, 0)
  if (total > 0 && Math.abs(total - 1) > 0.01) {
    for (const k of Object.keys(out) as Dimension[]) out[k] = out[k] / total
  }
  return out
}

function translateLegacyWeights(r: Record<string, unknown>): Weights {
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback
  const budget       = num(r.budget,        35)
  const rooms        = num(r.rooms,         20)
  const location     = num(r.location,      30)
  const niceToHave   = num(r.nice_to_have,   5)
  const dealBreakers = num(r.deal_breakers, 10)

  // Hold back small fixed shares for the secondary dims so they aren't crushed
  // even when the renter heavily weights the primaries.
  const reserveSqm = 0.06, reserveFloor = 0.03, reserveTiming = 0.04
  const mainShare = 1 - (reserveSqm + reserveFloor + reserveTiming) // 0.87

  const total = budget + rooms + location + niceToHave + dealBreakers
  if (total <= 0) return { ...DEFAULT_WEIGHTS }
  const factor = mainShare / total

  // deal_breakers spans both demographic (pets/smokers compat) and the "must"
  // amenities — split it half and half. nice_to_have flows fully into amenities.
  return {
    budget:      budget       * factor,
    rooms:       rooms        * factor,
    city:        location     * factor,
    amenities:   (niceToHave + dealBreakers * 0.5) * factor,
    demographic: (dealBreakers * 0.5) * factor,
    sqm:         reserveSqm,
    floor:       reserveFloor,
    timing:      reserveTiming,
  }
}

function scoreBudget(renter: RenterRow, property: PropertyRow, weight: number): DimensionResult {
  if (property.price == null || renter.budget_max == null) {
    return { weight, raw: 0.5, weighted: 0.5 * weight, note: 'אין מספיק נתוני תקציב' }
  }
  const flex = (renter.budget_flexibility ?? 0) / 100
  const hardCeiling = renter.budget_max * (1 + flex)
  const price = property.price

  if (price > hardCeiling) {
    // Above budget even with flex — minimal score, scales down linearly to 0 at 1.5× the budget.
    const overshoot = (price - hardCeiling) / hardCeiling
    const raw = Math.max(0, 0.3 - overshoot)
    return { weight, raw, weighted: raw * weight, note: `מחיר ₪${price.toLocaleString('he-IL')} מעל תקציב מקסימלי` }
  }

  if (price > renter.budget_max) {
    // In the flex zone — partial credit.
    const overshoot = (price - renter.budget_max) / (hardCeiling - renter.budget_max || 1)
    const raw = 0.7 - 0.4 * overshoot
    return { weight, raw, weighted: raw * weight, note: `מחיר בתחום הגמישות (+${Math.round((price - renter.budget_max) / renter.budget_max * 100)}%)` }
  }

  if (renter.budget_min != null && price < renter.budget_min * 0.6) {
    // Suspiciously cheap — small penalty (might be missing fees / scam / different size).
    return { weight, raw: 0.6, weighted: 0.6 * weight, note: 'מחיר נמוך מהצפוי, כדאי לבדוק' }
  }

  // Sweet spot — between min and max
  return { weight, raw: 1, weighted: weight, note: `מחיר ₪${price.toLocaleString('he-IL')} בתוך התקציב` }
}

function scoreCity(_r: RenterRow, property: PropertyRow, weight: number, hasList: boolean, preferred: string[], propertyCities: Set<string>): DimensionResult {
  if (!hasList) {
    return { weight, raw: 0.5, weighted: 0.5 * weight, note: 'אין רשימת ערים מועדפות' }
  }
  const exact = preferred.some(c => propertyCities.has(c))
  if (exact) return { weight, raw: 1, weighted: weight, note: `${property.city} ברשימה המועדפת` }
  const fuzzy = hasFuzzyCityMatch(propertyCities, preferred)
  if (fuzzy) return { weight, raw: 0.55, weighted: 0.55 * weight, note: `התאמה חלקית לעיר (${property.city})` }
  // Soft penalty rather than DQ — the property surfaces with a clearly lower
  // score so the admin still sees "close but wrong area" candidates.
  return { weight, raw: 0, weighted: 0, note: `${property.city} לא ברשימת הערים המבוקשת` }
}

function scoreRooms(renter: RenterRow, property: PropertyRow, weight: number): DimensionResult {
  if (renter.preferred_rooms == null || property.rooms == null) {
    return { weight, raw: 0.5, weighted: 0.5 * weight, note: 'חסר נתון חדרים' }
  }
  const diff = Math.abs(property.rooms - renter.preferred_rooms)
  if (diff < 0.01) return { weight, raw: 1, weighted: weight, note: `${property.rooms} חדרים — בדיוק כפי שביקש` }
  if (renter.rooms_flexible && diff <= 0.5) {
    return { weight, raw: 0.85, weighted: 0.85 * weight, note: `${property.rooms} חדרים — בטווח הגמישות` }
  }
  if (diff <= 1) return { weight, raw: 0.55, weighted: 0.55 * weight, note: `${property.rooms} חדרים — סטייה של ${diff}` }
  return { weight, raw: 0.2, weighted: 0.2 * weight, note: `${property.rooms} חדרים — שונה משמעותית מהבקשה` }
}

// Maps the renter's preference keys (from the questionnaire) to the property's
// `amenities` jsonb keys. Two flavors: "structural" amenities that the property
// either has or doesn't (balcony, parking, elevator, mamad, storage, …) and
// "any"-typed prefs we treat as informational (condition, top floor, etc.).
const AMENITY_KEY_MAP: Record<string, string> = {
  balcony:        'balcony',
  parking:        'parking',
  elevator:       'elevator',
  aircon:         'airConditioner',
  mamad:          'mamad',
  storage:        'storage',
  furnished:      'furnished',
  accessibility:  'accessibility',
  solar_heater:   'solarHeater',
  bars:           'bars',
  shelter:        'shelter',
  fiber_internet: 'fiberInternet',
  quiet:          'quiet',
}

const AMENITY_LABEL: Record<string, string> = {
  balcony:        'מרפסת',
  parking:        'חניה',
  elevator:       'מעלית',
  aircon:         'מזגן',
  mamad:          'ממ״ד',
  storage:        'מחסן',
  furnished:      'ריהוט',
  accessibility:  'נגישות',
  solar_heater:   'דוד שמש',
  bars:           'סורגים',
  shelter:        'מקלט',
  fiber_internet: 'אינטרנט סיבים',
  quiet:          'שקט',
}

function scoreAmenities(renter: RenterRow, property: PropertyRow, weight: number): DimensionResult {
  const prefs = (renter.preferences && typeof renter.preferences === 'object') ? renter.preferences as Record<string, any> : null
  const amen = (property.amenities && typeof property.amenities === 'object') ? property.amenities as Record<string, any> : {}

  if (!prefs) {
    return { weight, raw: 0.7, weighted: 0.7 * weight, note: 'אין העדפות אמצעים בשאלון' }
  }

  // Collect each preference that's actively ranked (must/nice). Skip 'any'/null.
  // Each preference contributes a per-item score:
  //   must + has  → 1.0
  //   must + miss → 0.0   (big hit — this is what they explicitly required)
  //   nice + has  → 1.0
  //   nice + miss → 0.55  (mild penalty — they wanted it but it's not a dealbreaker)
  // The dimension's `raw` is the average across all ranked items, so the
  // weight stays calibrated regardless of how many prefs a renter has.
  const items: Array<{ key: string; level: 'must' | 'nice'; has: boolean; score: number }> = []

  for (const [prefKey, propKey] of Object.entries(AMENITY_KEY_MAP)) {
    const pref = prefs[prefKey]
    if (!pref || typeof pref !== 'object') continue
    const level = (pref.level as string | undefined) ?? (pref.wanted === true ? 'nice' : undefined)
    if (level !== 'must' && level !== 'nice') continue

    const propVal = amen[propKey]
    // `has` is true for boolean true OR a truthy object/string. Some legacy
    // properties store amenities as strings like "yes"/"private" so we treat
    // anything truthy and non-"none" as having the feature.
    const has = !!propVal && propVal !== 'none' && propVal !== false
    const score = has ? 1.0 : (level === 'must' ? 0.0 : 0.55)
    items.push({ key: prefKey, level, has, score })
  }

  if (items.length === 0) {
    return { weight, raw: 0.7, weighted: 0.7 * weight, note: 'אין דרישות אמצעים מוגדרות' }
  }

  const raw = items.reduce((s, i) => s + i.score, 0) / items.length
  const missingMust = items.filter(i => i.level === 'must' && !i.has).map(i => AMENITY_LABEL[i.key] ?? i.key)
  const matchedMust = items.filter(i => i.level === 'must' && i.has).map(i => AMENITY_LABEL[i.key] ?? i.key)

  let note: string
  if (missingMust.length > 0) {
    note = `חסר: ${missingMust.join(', ')}`
  } else if (matchedMust.length > 0) {
    note = `מתאים: ${matchedMust.join(', ')}`
  } else {
    const matchedNice = items.filter(i => i.has).map(i => AMENITY_LABEL[i.key] ?? i.key)
    note = matchedNice.length > 0 ? `מתאים: ${matchedNice.join(', ')}` : 'אמצעים חלקיים'
  }

  return { weight, raw, weighted: raw * weight, note }
}

function scoreSqm(renter: RenterRow, property: PropertyRow, weight: number): DimensionResult {
  if (renter.min_sqm == null) return { weight, raw: 0.7, weighted: 0.7 * weight, note: 'לא הוגדר שטח מינימלי' }
  if (property.sqm == null) return { weight, raw: 0.5, weighted: 0.5 * weight, note: 'שטח הנכס לא ידוע' }
  if (property.sqm >= renter.min_sqm) return { weight, raw: 1, weighted: weight, note: `${property.sqm} מ"ר ≥ ${renter.min_sqm} מבוקש` }
  const ratio = property.sqm / renter.min_sqm
  return { weight, raw: ratio, weighted: ratio * weight, note: `${property.sqm} מ"ר קטן מהמינימום (${renter.min_sqm})` }
}

function scoreFloor(renter: RenterRow, property: PropertyRow, weight: number): DimensionResult {
  const fmin = renter.floor_min, fmax = renter.floor_max
  if (fmin == null && fmax == null) return { weight, raw: 0.7, weighted: 0.7 * weight, note: 'אין העדפת קומה' }
  if (property.floor == null) return { weight, raw: 0.5, weighted: 0.5 * weight, note: 'קומת הנכס לא ידועה' }
  const f = property.floor
  if ((fmin == null || f >= fmin) && (fmax == null || f <= fmax)) {
    return { weight, raw: 1, weighted: weight, note: `קומה ${f} בטווח המבוקש` }
  }
  const distance = fmin != null && f < fmin ? fmin - f : (fmax != null && f > fmax ? f - fmax : 0)
  const raw = Math.max(0.2, 1 - distance * 0.2)
  return { weight, raw, weighted: raw * weight, note: `קומה ${f} מחוץ לטווח (סטייה ${distance})` }
}

function scoreTiming(renter: RenterRow, property: PropertyRow, weight: number): DimensionResult {
  const desired = renter.move_in_date
  const available = property.evacuation_date || property.available_from
  if (!desired || !available) return { weight, raw: 0.7, weighted: 0.7 * weight, note: 'תזמון לא חסום (חסר תאריך)' }

  const desiredTs = Date.parse(desired)
  const availableTs = Date.parse(available)
  if (Number.isNaN(desiredTs) || Number.isNaN(availableTs)) {
    return { weight, raw: 0.6, weighted: 0.6 * weight, note: 'בעיה בקריאת תאריכים' }
  }
  const diffDays = Math.abs(desiredTs - availableTs) / 86400000
  const buffer = renter.move_in_flexible ? 21 : 7
  if (diffDays <= buffer) return { weight, raw: 1, weighted: weight, note: `תזמון תואם (סטייה ${Math.round(diffDays)} ימים)` }
  if (diffDays <= 45) {
    const raw = Math.max(0.3, 1 - (diffDays - buffer) / 45)
    return { weight, raw, weighted: raw * weight, note: `תזמון קרוב (סטייה ${Math.round(diffDays)} ימים)` }
  }
  return { weight, raw: 0.2, weighted: 0.2 * weight, note: `סטיית תזמון של ${Math.round(diffDays)} ימים` }
}

function scoreDemographic(renter: RenterRow, property: PropertyRow, weight: number): DimensionResult {
  // Hard mismatches were already caught as DQ. Here we reward explicit accommodating signals.
  const positives: string[] = []
  let raw = 0.7   // neutral baseline
  if (renter.has_pets === true && property.pets_allowed === true) { raw = Math.min(1, raw + 0.2); positives.push('מאפשר חיות') }
  if (renter.smokers === true && property.smokers_allowed === true) { raw = Math.min(1, raw + 0.1); positives.push('מאפשר עישון') }
  const note = positives.length ? `התאמה דמוגרפית: ${positives.join(', ')}` : 'התאמה דמוגרפית כללית'
  return { weight, raw, weighted: raw * weight, note }
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  return []
}

function toLowerSet(arr: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>()
  for (const s of arr) if (typeof s === 'string' && s.trim()) out.add(s.trim().toLowerCase())
  return out
}

// Soft match for Hebrew city variants ("קרית" vs "קריית" vs "ק\"ית", trailing punctuation, neighborhood vs city).
function hasFuzzyCityMatch(propertyCities: Set<string>, preferred: string[]): boolean {
  // Collapse the "קרית" prefix in all its written forms:
  //   "קריית"  (ק-ר-י-י-ת, two yods)
  //   "קרית"   (ק-ר-י-ת)
  //   "ק\"ית" / "ק'ית" / "ק.ית" (apostrophe/quote/dot between ק and י)
  // Everything maps to canonical "קרית" before the rest of the city name.
  const normalize = (s: string) => s
    .replace(/^ק[\s"'.]*ר?\s*י{1,3}\s*ת\s*/, 'קרית ')
    .replace(/[\s"',.()-]/g, '')
    .trim()
  const propSet = new Set(Array.from(propertyCities).map(normalize))
  return preferred.some(p => {
    const np = normalize(p)
    if (propSet.has(np)) return true
    // Substring match — e.g. "חיפה" matches "חיפה - מגורים"
    for (const c of propSet) {
      if (c.length >= 3 && (c.includes(np) || np.includes(c))) return true
    }
    return false
  })
}
