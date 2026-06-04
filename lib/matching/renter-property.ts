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
  preferred_neighborhoods: unknown     // jsonb — array of strings (optional)
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
  notes_embedding?: number[] | null     // 1536-dim vector of the renter's notes
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
  embedding?: number[] | null           // 1536-dim vector of the property's description/full_text
}

// Weights are nominal — the final score is normalized over only the
// dimensions the renter actually filled in. So if she only specifies
// budget+city+rooms, those three are re-scaled to sum to 1.0 and the
// other dimensions are dropped from both numerator and denominator.
// This is what makes "didn't ask" actually mean "doesn't affect the
// score" instead of silently injecting a neutral 70%.
export const DEFAULT_WEIGHTS = {
  budget: 0.23,
  city: 0.18,
  neighborhood: 0.09,
  rooms: 0.11,
  amenities_must: 0.18,   // each missing 'must' item drops the score hard
  amenities_nice: 0.04,   // simple proportion of nice items present
  text_similarity: 0.07,  // cosine similarity between renter notes and property text
  sqm: 0.04,
  floor: 0.02,
  timing: 0.02,
  demographic: 0.02,
} as const

export type Weights = { -readonly [K in keyof typeof DEFAULT_WEIGHTS]: number }
export type Dimension = keyof Weights

export type DimensionResult = {
  weight: number       // 0-1
  raw: number          // 0-1, before weight
  weighted: number     // raw * weight (kept for backwards compat / inspection)
  note: string         // human-readable Hebrew note for the UI
  applies?: boolean    // false → renter didn't fill this in; excluded from the score
  items?: Array<{      // optional per-item breakdown (used by amenities)
    key: string
    label: string
    level: 'must' | 'nice'
    has: boolean
  }>
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
  // Strip the "- מגורים" suffix that some renters still have in their
  // preferred_cities (legacy data — newer rows are cleaned at submit time).
  // Without this strip, "חיפה - מגורים" never matches "חיפה" and falls to fuzzy.
  const preferredCities = toStringArray(renter.preferred_cities)
    .map(s => s.replace(/\s*-\s*מגורים\s*$/, '').trim().toLowerCase())
    .filter(Boolean)
  const hasCityList = preferredCities.length > 0

  if (renter.has_pets === true && property.pets_allowed === false) {
    disqualifyingReasons.push('השוכר עם חיות מחמד אבל הנכס לא מאפשר חיות')
  }

  if (renter.smokers === true && property.smokers_allowed === false) {
    disqualifyingReasons.push('השוכר מעשן אבל הנכס לא מאפשר עישון')
  }

  // Divided / shared apartment ("דירה מחולקת"): if the renter said it does NOT suit them
  // and the property is a divided apartment, disqualify — same severity as pets/smokers.
  // Only DQ when the property is KNOWN divided (=== true); unknown/absent never blocks.
  {
    const dprefs = (renter.preferences && typeof renter.preferences === 'object') ? renter.preferences as Record<string, any> : null
    const damen = (property.amenities && typeof property.amenities === 'object') ? property.amenities as Record<string, any> : null
    const dividedOk = dprefs?.divided_ok
    const propDivided = damen?.divided === true || damen?.divided === 'true'
    if (dividedOk === false && propDivided) {
      disqualifyingReasons.push('השוכר ביקש דירה לא מחולקת אבל הנכס מחולק')
    }
  }

  // ----- Soft dimensions -----------------------------------------------------
  breakdown.budget = scoreBudget(renter, property, weights.budget)
  breakdown.city = scoreCity(renter, property, weights.city, hasCityList, preferredCities, propertyCities)
  breakdown.neighborhood = scoreNeighborhood(renter, property, weights.neighborhood)
  breakdown.rooms = scoreRooms(renter, property, weights.rooms)
  const amenityPair = scoreAmenitiesSplit(renter, property, weights.amenities_must, weights.amenities_nice)
  breakdown.amenities_must = amenityPair.must
  breakdown.amenities_nice = amenityPair.nice
  breakdown.sqm = scoreSqm(renter, property, weights.sqm)
  breakdown.floor = scoreFloor(renter, property, weights.floor)
  breakdown.timing = scoreTiming(renter, property, weights.timing)
  breakdown.demographic = scoreDemographic(renter, property, weights.demographic)
  breakdown.text_similarity = scoreTextSimilarity(renter, property, weights.text_similarity)

  // Re-normalize over applicable dimensions only. A dimension with
  // applies=false ("didn't ask") is excluded from BOTH the numerator and
  // the denominator, so "she only filled budget + city + rooms" produces a
  // score that reflects exactly those three at full weight.
  const applicable = Object.values(breakdown).filter(d => d.applies !== false)
  const applicableWeight = applicable.reduce((s, d) => s + d.weight, 0)
  const isDisqualified = disqualifyingReasons.length > 0
  let score = isDisqualified
    ? 0
    : applicableWeight > 0
      ? Math.round((applicable.reduce((s, d) => s + d.raw * d.weight, 0) / applicableWeight) * 100)
      : 50

  // Hard cap on missing "חובה" amenities. Per user spec: if ANY item the
  // renter explicitly marked as 'must' is missing on the property, the
  // overall score can't exceed 50 — regardless of how generous the
  // weighted-average came out. This makes "חובה" mean "deal breaker" in
  // the actual scoring, not just a heavier weighted contribution.
  const mustItems = breakdown.amenities_must?.items ?? []
  const missingMustCount = mustItems.filter(i => !i.has).length
  if (!isDisqualified && missingMustCount > 0) {
    score = Math.min(score, 50)
  }

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
  // location is split 70/30 city/neighborhood: the questionnaire only asked
  // about cities, so we keep most of the location weight there and give
  // neighborhood a smaller share that activates if/when the renter fills it.
  // amenities_must gets the deal_breakers contribution (the renter calls it
  // a "deal breaker" — it is, hence the heavy weight). amenities_nice gets
  // the nice_to_have allocation. text_similarity gets the new default share
  // (the legacy questionnaire didn't have a slider for it).
  return {
    budget:           budget   * factor,
    rooms:            rooms    * factor,
    city:             location * 0.70 * factor,
    neighborhood:     location * 0.30 * factor,
    amenities_must:   dealBreakers * factor,
    amenities_nice:   niceToHave   * factor,
    demographic:      Math.max(0.02, dealBreakers * 0.2 * factor),
    text_similarity:  DEFAULT_WEIGHTS.text_similarity,
    sqm:              reserveSqm,
    floor:            reserveFloor,
    timing:           reserveTiming,
  }
}

function scoreBudget(renter: RenterRow, property: PropertyRow, weight: number): DimensionResult {
  if (renter.budget_max == null) {
    return { weight, raw: 0, weighted: 0, note: 'לא ביקש תקציב מקסימלי', applies: false }
  }
  if (property.price == null) {
    return { weight, raw: 0.5, weighted: 0.5 * weight, note: 'אין מחיר לנכס', applies: false }
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
    return { weight, raw: 0, weighted: 0, note: 'לא ביקש ערים מועדפות', applies: false }
  }
  const exact = preferred.some(c => propertyCities.has(c))
  if (exact) return { weight, raw: 1, weighted: weight, note: `${property.city} ברשימה המועדפת` }
  const fuzzy = hasFuzzyCityMatch(propertyCities, preferred)
  if (fuzzy) return { weight, raw: 0.55, weighted: 0.55 * weight, note: `התאמה חלקית לעיר (${property.city})` }
  // Soft penalty rather than DQ — the property surfaces with a clearly lower
  // score so the admin still sees "close but wrong area" candidates.
  return { weight, raw: 0, weighted: 0, note: `${property.city} לא ברשימת הערים המבוקשת` }
}

function scoreNeighborhood(renter: RenterRow, property: PropertyRow, weight: number): DimensionResult {
  const preferred = toStringArray(renter.preferred_neighborhoods).map(s => s.trim()).filter(Boolean)
  // Renter didn't pick any neighborhoods → excluded entirely from the score.
  if (preferred.length === 0) {
    return { weight, raw: 0, weighted: 0, note: 'לא ביקש שכונה', applies: false }
  }
  if (!property.neighborhood) {
    return { weight, raw: 0.5, weighted: 0.5 * weight, note: 'אין שכונה ידועה לנכס' }
  }
  const propNbh = property.neighborhood.trim().toLowerCase()
  const wanted = preferred.map(p => p.toLowerCase())
  if (wanted.includes(propNbh)) {
    return { weight, raw: 1, weighted: weight, note: `${property.neighborhood} ברשימת השכונות` }
  }
  // Substring match for noisy data like "מרכז" matching "מרכז העיר".
  for (const w of wanted) {
    if (w.length >= 3 && (propNbh.includes(w) || w.includes(propNbh))) {
      return { weight, raw: 0.55, weighted: 0.55 * weight, note: `התאמה חלקית לשכונה (${property.neighborhood})` }
    }
  }
  return { weight, raw: 0, weighted: 0, note: `${property.neighborhood} לא ברשימת השכונות` }
}

function scoreRooms(renter: RenterRow, property: PropertyRow, weight: number): DimensionResult {
  if (renter.preferred_rooms == null) {
    return { weight, raw: 0, weighted: 0, note: 'לא ביקש מספר חדרים', applies: false }
  }
  if (property.rooms == null) {
    return { weight, raw: 0.5, weighted: 0.5 * weight, note: 'חסר נתון חדרים בנכס', applies: false }
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
  yard:           'garden',
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
  yard:           'חצר',
}

function scoreAmenitiesSplit(
  renter: RenterRow,
  property: PropertyRow,
  weightMust: number,
  weightNice: number,
): { must: DimensionResult; nice: DimensionResult } {
  const prefs = (renter.preferences && typeof renter.preferences === 'object') ? renter.preferences as Record<string, any> : null
  const amen = (property.amenities && typeof property.amenities === 'object') ? property.amenities as Record<string, any> : {}

  const mustItems: Array<{ key: string; label: string; level: 'must'; has: boolean }> = []
  const niceItems: Array<{ key: string; label: string; level: 'nice'; has: boolean }> = []

  if (prefs) {
    for (const [prefKey, propKey] of Object.entries(AMENITY_KEY_MAP)) {
      const pref = prefs[prefKey]
      if (!pref || typeof pref !== 'object') continue
      const level = (pref.level as string | undefined) ?? (pref.wanted === true ? 'nice' : undefined)
      if (level !== 'must' && level !== 'nice') continue

      const propVal = amen[propKey]
      const has = !!propVal && propVal !== 'none' && propVal !== false
      const label = AMENITY_LABEL[prefKey] ?? prefKey
      if (level === 'must') mustItems.push({ key: prefKey, label, level: 'must', has })
      else                  niceItems.push({ key: prefKey, label, level: 'nice', has })
    }
  }

  return {
    must: scoreMustDimension(mustItems, weightMust),
    nice: scoreNiceDimension(niceItems, weightNice),
  }
}

function scoreMustDimension(
  items: Array<{ key: string; label: string; level: 'must'; has: boolean }>,
  weight: number,
): DimensionResult {
  if (items.length === 0) {
    return { weight, raw: 0, weighted: 0, note: 'לא ביקש אמצעי חובה', applies: false, items: [] }
  }
  // Each missing must costs heavily. raw = max(0, 1 − 1.5×(missing/total)).
  // 0/N missing → 1.0; 1/3 missing → 0.5; 2/3 missing → 0.0.
  const missingCount = items.filter(i => !i.has).length
  const raw = Math.max(0, 1 - 1.5 * (missingCount / items.length))
  const missing = items.filter(i => !i.has).map(i => i.label)
  const matched = items.filter(i =>  i.has).map(i => i.label)
  const note = missing.length > 0
    ? `חסר: ${missing.join(', ')}`
    : matched.length > 0 ? `כל החובות קיימים: ${matched.join(', ')}` : 'אין אמצעי חובה'

  const orderForUi = items.slice().sort((a, b) => Number(a.has) - Number(b.has))
  return { weight, raw, weighted: raw * weight, note, items: orderForUi }
}

function scoreNiceDimension(
  items: Array<{ key: string; label: string; level: 'nice'; has: boolean }>,
  weight: number,
): DimensionResult {
  if (items.length === 0) {
    return { weight, raw: 0, weighted: 0, note: 'לא ביקש אמצעים רצויים', applies: false, items: [] }
  }
  // Simple proportion of nice items present.
  const presentCount = items.filter(i => i.has).length
  const raw = presentCount / items.length
  const missing = items.filter(i => !i.has).map(i => i.label)
  const matched = items.filter(i =>  i.has).map(i => i.label)
  const note = missing.length > 0
    ? `חסר: ${missing.join(', ')}`
    : `הכל קיים: ${matched.join(', ')}`

  const orderForUi = items.slice().sort((a, b) => Number(a.has) - Number(b.has))
  return { weight, raw, weighted: raw * weight, note, items: orderForUi }
}

function scoreSqm(renter: RenterRow, property: PropertyRow, weight: number): DimensionResult {
  if (renter.min_sqm == null) return { weight, raw: 0, weighted: 0, note: 'לא ביקש שטח מינימלי', applies: false }
  if (property.sqm == null) return { weight, raw: 0.5, weighted: 0.5 * weight, note: 'שטח הנכס לא ידוע', applies: false }
  if (property.sqm >= renter.min_sqm) return { weight, raw: 1, weighted: weight, note: `${property.sqm} מ"ר ≥ ${renter.min_sqm} מבוקש` }
  // Below the minimum the renter asked for — penalize roughly 3× the gap so
  // a 10% shortfall drops to ~0.7 (border of "קיים"/"חלקי") and a 20% shortfall
  // sits clearly in "חלקי". Linear-with-ratio (the previous formula) was too
  // gentle: 60 vs 70 gave raw 0.86 → "קיים" in the UI, which read wrong.
  const ratio = property.sqm / renter.min_sqm
  const raw = Math.max(0, 1 - 3 * (1 - ratio))
  return { weight, raw, weighted: raw * weight, note: `${property.sqm} מ"ר קטן מהמינימום (${renter.min_sqm})` }
}

function scoreFloor(renter: RenterRow, property: PropertyRow, weight: number): DimensionResult {
  const fmin = renter.floor_min, fmax = renter.floor_max
  if (fmin == null && fmax == null) return { weight, raw: 0, weighted: 0, note: 'לא ביקש העדפת קומה', applies: false }
  if (property.floor == null) return { weight, raw: 0.5, weighted: 0.5 * weight, note: 'קומת הנכס לא ידועה', applies: false }
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
  if (!desired) return { weight, raw: 0, weighted: 0, note: 'לא ביקש מועד כניסה', applies: false }
  if (!available) return { weight, raw: 0.5, weighted: 0.5 * weight, note: 'אין תאריך פינוי לנכס', applies: false }

  const desiredTs = Date.parse(desired)
  const availableTs = Date.parse(available)
  if (Number.isNaN(desiredTs) || Number.isNaN(availableTs)) {
    return { weight, raw: 0.6, weighted: 0.6 * weight, note: 'בעיה בקריאת תאריכים', applies: false }
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
  // Only applies when the renter actually declared pets or smoking. Otherwise
  // there's nothing to compare against and the dimension drops out.
  const renterHasPets = renter.has_pets === true
  const renterSmokes  = renter.smokers === true
  if (!renterHasPets && !renterSmokes) {
    return { weight, raw: 0, weighted: 0, note: 'לא ביקש דרישות דמוגרפיות', applies: false }
  }
  const positives: string[] = []
  let raw = 0.7
  if (renterHasPets && property.pets_allowed === true)     { raw = Math.min(1, raw + 0.2); positives.push('מאפשר חיות') }
  if (renterSmokes  && property.smokers_allowed === true)  { raw = Math.min(1, raw + 0.1); positives.push('מאפשר עישון') }
  const note = positives.length ? `התאמה דמוגרפית: ${positives.join(', ')}` : 'התאמה דמוגרפית כללית'
  return { weight, raw, weighted: raw * weight, note }
}

function scoreTextSimilarity(renter: RenterRow, property: PropertyRow, weight: number): DimensionResult {
  const rVec = parseVector(renter.notes_embedding)
  const pVec = parseVector(property.embedding)
  if (!rVec || !pVec) {
    return { weight, raw: 0, weighted: 0, note: 'אין תיאור חופשי שאפשר להשוות', applies: false }
  }
  if (rVec.length !== pVec.length) {
    // Defensive — both should be 1536d from text-embedding-3-small.
    return { weight, raw: 0, weighted: 0, note: 'אי-התאמה במימדי הוקטור', applies: false }
  }

  const sim = cosineSimilarity(rVec, pVec)

  // Calibration tuned to the observed distribution on the live inventory:
  // Hebrew rental notes vs Hebrew rental descriptions land in [0.28, 0.62]
  // with an average around 0.44 (lots of shared generic vocabulary —
  // "דירה", "חדרים", "מרפסת" — bumps the floor). Map the actual relevant
  // band to [0, 1] so the dimension actually discriminates instead of
  // saturating to 1.0 for almost every match:
  //   sim ≤ 0.30 → raw 0   (text doesn't tell us anything useful)
  //   sim   0.45 → raw 0.6 (avg case — moderate signal)
  //   sim ≥ 0.55 → raw 1.0 (genuinely close semantic match)
  const raw = Math.max(0, Math.min(1, (sim - 0.30) / 0.25))

  const pct = Math.round(sim * 100)
  let note: string
  if (raw >= 0.7)      note = `דמיון טקסטואלי גבוה (${pct}%)`
  else if (raw >= 0.4) note = `דמיון טקסטואלי בינוני (${pct}%)`
  else                 note = `אין דמיון טקסטואלי מובהק (${pct}%)`

  return { weight, raw, weighted: raw * weight, note }
}

/** Postgres' `vector` columns come back as either an array (json) or the
 *  literal string "[0.1,0.2,...]" depending on the client. Normalize both. */
function parseVector(v: unknown): number[] | null {
  if (!v) return null
  if (Array.isArray(v)) return v.filter(n => typeof n === 'number') as number[]
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v)
      if (Array.isArray(parsed)) return parsed.filter(n => typeof n === 'number')
    } catch { return null }
  }
  return null
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number
    const y = b[i] as number
    dot += x * y
    na  += x * x
    nb  += y * y
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
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
