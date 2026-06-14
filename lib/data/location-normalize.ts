/**
 * Canonical Israeli place-name matcher for Haifa + Krayot.
 *
 * One job: given a renter's preferred places (cities AND neighborhoods) and a
 * property's (city, neighborhood), decide HOW WELL each field matches and at
 * WHICH TIER — independently per field.
 *
 * Hard requirements (from adversarial review — do not relax):
 *   1. PER-FIELD results. cityScore and neighborhoodScore are computed
 *      independently. A win on city must NOT fabricate a neighborhood match,
 *      and vice-versa.
 *   2. NO bidirectional substring matching. "parent contains child" is decided
 *      ONLY via the derived hierarchy table. Everything else is Jaccard overlap
 *      on DISCRIMINATIVE tokens (stoplist removed). A single shared structural
 *      token (קרית / שכונת / …) can NEVER produce a fuzzy hit.
 *   3. group (0.45) < sibling (0.55), strictly.
 *   4. "none" → 0.0, NEVER a disqualification. This module only scores.
 *
 * Hierarchy + Krayot group are DERIVED from lib/data/known-neighborhoods.ts so
 * the two files cannot drift.
 */

import { KNOWN_NEIGHBORHOODS_PER_CITY } from './known-neighborhoods'

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

export type Tier =
  | 'exact'         // 1.0  identical place (city↔city or nbh↔nbh)
  | 'neighborhood'  // 1.0  wanted nbh === prop nbh
  | 'subarea'       // 0.85 wanted = parent city, prop is a known sub-area of it
  | 'sibling'       // 0.55 same parent, different directional sub-area
  | 'fuzzy'         // 0.50 discriminative-token Jaccard overlap ≥ threshold
  | 'group'         // 0.45 wanted = קריות/הקריות, prop ∈ Krayot group
  | 'none'          // 0.0  no match (NEVER a disqualification)

export const TIER_SCORE: Record<Tier, number> = {
  exact: 1.0,
  neighborhood: 1.0,
  subarea: 0.85,
  sibling: 0.55,
  fuzzy: 0.5,
  group: 0.45,
  none: 0.0,
}

export type FieldResult = { tier: Tier; score: number }

export type ComparePlacesResult = {
  cityTier: Tier
  cityScore: number
  neighborhoodTier: Tier
  neighborhoodScore: number
}

// ---------------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------------

// Structural / non-discriminative tokens. If the ONLY thing two strings share
// is one of these, that is not a real match — drop them before Jaccard.
const STOPLIST = new Set<string>([
  'קרית',
  'קריית',
  'שכונת',
  'שכונה',
  'רובע',
  'מתחם',
  'העיר',
])

// Tokens that signal a directional / generational sub-area (the sibling test).
const DIRECTION_TOKENS = new Set<string>([
  'מזרחית', 'מערבית', 'צפונית', 'דרומית',
  'מזרח', 'מערב', 'צפון', 'דרום',
  'עליון', 'עליונה', 'תחתון', 'תחתונה',
  'הוותיקה', 'הותיקה', 'החדשה', 'הישנה', 'הוותיק', 'הישן',
])

/**
 * Collapse a place name to a single canonical surface form.
 *
 *  - NFC + trim, collapse internal whitespace.
 *  - Strip the legacy " - מגורים" suffix (questionnaire leftovers).
 *  - Krayot prefix unification: "קריית" (2 yods) / "קרייית" (3 yods) → "קרית";
 *    abbreviated "ק." / "ק " / 'ק"' / "ק'" forms → "קרית ".
 *  - Strip gershayim/geresh/quotes; turn commas/hyphens into separators.
 *  - toLowerCase folds embedded Latin (Hebrew is unaffected).
 *  - Nullish / non-string → "".
 */
export function canonicalizePlace(s: string | null | undefined): string {
  if (!s || typeof s !== 'string') return ''
  let out = s.normalize('NFC').trim()
  if (!out) return ''

  // Legacy questionnaire suffix: "חיפה - מגורים" → "חיפה" (before hyphen strip).
  out = out.replace(/\s*-\s*מגורים\s*$/u, '')

  // Krayot three/two-yod forms → one yod. Must run before the abbreviation
  // pass and before punctuation removal.
  out = out.replace(/קרייית/gu, 'קרית').replace(/קריית/gu, 'קרית')

  // Abbreviated municipal prefix at the start: "ק. חיים" / "ק' חיים" / 'ק"חיים'
  // / "ק חיים" → "קרית חיים". The optional ר + yods covers "ק.ר.ית"-ish noise.
  out = out.replace(/^ק["'.\s]+ר?\s*י{0,3}\s*ת?\s+/u, 'קרית ')

  // Quotes / geresh / gershayim → removed; commas / hyphens → space.
  out = out
    .replace(/["'`׳״]/gu, '')
    .replace(/[,־–—-]/gu, ' ')

  // Collapse whitespace, fold Latin case.
  out = out.replace(/\s+/gu, ' ').trim().toLowerCase()

  // Second abbreviation pass: handles "ק.חיים" where the dot was the only
  // separator (now a space) so the prefix can resolve.
  out = out
    .replace(/^ק\s+ר?\s*י{0,3}\s*ת?\s+/u, 'קרית ')
    .replace(/\s+/gu, ' ')
    .trim()

  return out
}

/** Discriminative tokens: canonicalized, split on whitespace, stoplist removed. */
export function canonicalTokens(s: string | null | undefined): string[] {
  const canon = canonicalizePlace(s)
  if (!canon) return []
  return canon.split(' ').filter(t => t.length > 0 && !STOPLIST.has(t))
}

// ---------------------------------------------------------------------------
// Hierarchy + Krayot group, DERIVED from known-neighborhoods.ts
// ---------------------------------------------------------------------------

/** city (canonical) → Set<sub-area / neighborhood canonical>. */
export const CITY_HIERARCHY: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const m = new Map<string, Set<string>>()
  for (const [city, list] of Object.entries(KNOWN_NEIGHBORHOODS_PER_CITY)) {
    const cityKey = canonicalizePlace(city)
    if (!cityKey) continue
    const set = m.get(cityKey) ?? new Set<string>()
    for (const n of list) {
      const nk = canonicalizePlace(n)
      if (nk) set.add(nk)
    }
    m.set(cityKey, set)
  }
  return m
})()

/** Reverse index: sub-area / neighborhood (canonical) → parent city (canonical). */
const SUBAREA_TO_PARENT: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>()
  for (const [city, subs] of CITY_HIERARCHY) {
    for (const n of subs) if (!m.has(n)) m.set(n, city)
  }
  return m
})()

/**
 * The Krayot municipalities = every directory city key whose canonical name
 * starts with "קרית " (קרית ביאליק / מוצקין / אתא / ים / חיים). חיפה is
 * excluded automatically; קריית חיים is correctly included.
 */
export const KRAYOT_GROUP: ReadonlySet<string> = (() => {
  const set = new Set<string>()
  for (const city of CITY_HIERARCHY.keys()) {
    if (city.startsWith('קרית ')) set.add(city)
  }
  return set
})()

/** Sentinel meaning "the renter typed קריות / הקריות" (the whole group). */
const GROUP_SENTINEL = ' krayot-group'

/**
 * Alias map → canonical surface. Keys are already canonical (post
 * canonicalizePlace). "קריות"/"הקריות"/"הקריון" expand to the group sentinel.
 */
const ALIASES: ReadonlyMap<string, string> = new Map<string, string>([
  ['קריות', GROUP_SENTINEL],
  ['הקריות', GROUP_SENTINEL],
  ['הקריון', GROUP_SENTINEL],
])

function applyAlias(canon: string): string {
  return ALIASES.get(canon) ?? canon
}

// ---------------------------------------------------------------------------
// Discriminative-token fuzzy (Jaccard) — the ONLY fuzzy path
// ---------------------------------------------------------------------------

const FUZZY_THRESHOLD = 0.5

/**
 * Jaccard overlap on discriminative tokens. Returns 0 when either side has no
 * discriminative tokens, or when there is no shared discriminative token — so a
 * lone structural token (קרית / שכונת / …) can NEVER trigger fuzzy.
 */
function discriminativeJaccard(a: string, b: string): number {
  const ta = new Set(canonicalTokens(a))
  const tb = new Set(canonicalTokens(b))
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  if (inter === 0) return 0
  const union = ta.size + tb.size - inter
  return inter / union
}

// ---------------------------------------------------------------------------
// Per-field comparison
// ---------------------------------------------------------------------------

const NONE: FieldResult = { tier: 'none', score: 0 }
function res(tier: Tier): FieldResult {
  return { tier, score: TIER_SCORE[tier] }
}

/** Parent city of a canonical place: itself if a known city, else its parent, else null. */
function parentCityOf(canon: string): string | null {
  if (CITY_HIERARCHY.has(canon)) return canon
  return SUBAREA_TO_PARENT.get(canon) ?? null
}

/** Direction tokens present in a canonical place name. */
function directionsOf(canon: string): Set<string> {
  const out = new Set<string>()
  for (const t of canon.split(' ')) if (DIRECTION_TOKENS.has(t)) out.add(t)
  return out
}

/**
 * Sibling test: same parent city, both sides carry directional tokens, and
 * they share NO direction (different sub-area). Used for both fields.
 */
function isSibling(w: string, prop: string): boolean {
  if (w === prop) return false
  const wParent = parentCityOf(w)
  const pParent = parentCityOf(prop)
  if (!wParent || !pParent || wParent !== pParent) return false
  const wDir = directionsOf(w)
  const pDir = directionsOf(prop)
  if (wDir.size === 0 || pDir.size === 0) return false
  for (const d of wDir) if (pDir.has(d)) return false // shares a direction → not a sibling
  return true
}

/**
 * Score the CITY field on its own. `wantedCanon` = renter's preferred places
 * (cities AND neighborhoods), canonicalized + alias-applied.
 */
function compareCity(wantedCanon: string[], propCity: string): FieldResult {
  if (!propCity) return NONE

  const propParent = parentCityOf(propCity)
  const propIsKrayot = KRAYOT_GROUP.has(propParent ?? propCity)

  let best: FieldResult = NONE
  const consider = (r: FieldResult) => { if (r.score > best.score) best = r }

  for (const w of wantedCanon) {
    if (w === propCity) { consider(res('exact')); continue }

    // subarea: wanted is a PARENT CITY, prop is one of its known sub-areas.
    if (CITY_HIERARCHY.has(w)) {
      const subs = CITY_HIERARCHY.get(w)!
      if (subs.has(propCity)) { consider(res('subarea')); continue }
    }

    // sibling: same parent, both directional, different direction.
    if (isSibling(w, propCity)) { consider(res('sibling')); continue }

    // group: renter said קריות/הקריות and prop ∈ Krayot group. Strictly < sibling.
    if (w === GROUP_SENTINEL) {
      if (propIsKrayot) consider(res('group'))
      continue
    }

    // fuzzy: discriminative-token Jaccard. Never on a lone structural token.
    if (discriminativeJaccard(w, propCity) >= FUZZY_THRESHOLD) consider(res('fuzzy'))
  }

  return best
}

/**
 * Score the NEIGHBORHOOD field on its own. A pure city win does NOT flow here:
 * any wanted value that is itself a known city is skipped, so "renter wants the
 * city X" never fabricates a neighborhood win.
 */
function compareNeighborhood(wantedCanon: string[], propNbh: string): FieldResult {
  if (!propNbh) return NONE

  let best: FieldResult = NONE
  const consider = (r: FieldResult) => { if (r.score > best.score) best = r }

  for (const w of wantedCanon) {
    if (w === GROUP_SENTINEL) continue // group is a CITY concept, not a nbh

    if (w === propNbh) { consider(res('neighborhood')); continue }

    // A wanted value that is itself a known CITY may only win the neighborhood
    // field as a *subarea* — i.e. when the property neighborhood is a known
    // sub-area of that city. It must NOT fabricate a fuzzy/sibling nbh win.
    if (CITY_HIERARCHY.has(w)) {
      const subs = CITY_HIERARCHY.get(w)!
      if (subs.has(propNbh)) consider(res('subarea'))
      continue
    }

    // sibling: same parent, both directional, different direction.
    if (isSibling(w, propNbh)) { consider(res('sibling')); continue }

    // fuzzy: discriminative-token Jaccard.
    if (discriminativeJaccard(w, propNbh) >= FUZZY_THRESHOLD) consider(res('fuzzy'))
  }

  return best
}

/**
 * Public entry point. Returns PER-FIELD tiers + scores, computed independently.
 *
 * @param wanted  renter's preferred cities AND neighborhoods (raw strings).
 * @param propCity         property.city (raw, may be null).
 * @param propNeighborhood property.neighborhood (raw, may be null).
 */
export function comparePlaces(
  wanted: Array<string | null | undefined>,
  propCity: string | null | undefined,
  propNeighborhood: string | null | undefined,
): ComparePlacesResult {
  const wantedCanon = wanted
    .map(canonicalizePlace)
    .filter((s): s is string => s.length > 0)
    .map(applyAlias)

  const pCity = applyAlias(canonicalizePlace(propCity))
  const pNbh = applyAlias(canonicalizePlace(propNeighborhood))

  const city = compareCity(wantedCanon, pCity)
  const neighborhood = compareNeighborhood(wantedCanon, pNbh)

  return {
    cityTier: city.tier,
    cityScore: city.score,
    neighborhoodTier: neighborhood.tier,
    neighborhoodScore: neighborhood.score,
  }
}
