/**
 * Single source of truth for amenity → Hebrew label.
 *
 * The keys here are the canonical English keys used in `properties.amenities`
 * (jsonb). Both the renter questionnaire and the matching engine refer to the
 * same keys, so any rendering of the amenity set should run through this map
 * instead of hard-coding labels per component.
 *
 * Keep this file in sync with:
 *   - lib/data/extract-amenities-from-text.ts → AmenityKey union
 *   - lib/matching/renter-property.ts         → AMENITY_KEY_MAP / AMENITY_LABEL
 *   - app/r/[token]/page.tsx                  → Preferences type
 */

export const AMENITY_LABELS: Record<string, string> = {
  parking:        'חניה',
  airConditioner: 'מזגן',
  storage:        'מחסן',
  balcony:        'מרפסת',
  elevator:       'מעלית',
  mamad:          'ממ״ד',
  furnished:      'מרוהטת',
  solarHeater:    'דוד שמש',
  bars:           'סורגים',
  shelter:        'מקלט',
  fiberInternet:  'אינטרנט סיבים',
  accessibility:  'נגישות',
  // Legacy lowercase fallbacks that show up in older rows
  airconditioner: 'מזגן',
  solarheater:    'דוד שמש',
  fiberinternet:  'אינטרנט סיבים',
}

/** Get the Hebrew label for an amenity key, falling back to the raw key. */
export function amenityLabel(key: string): string {
  return AMENITY_LABELS[key] ?? AMENITY_LABELS[key.toLowerCase()] ?? key
}

/** Map an amenities object → array of Hebrew labels for keys that are truthy. */
export function amenityLabelsFrom(amenities: unknown): string[] {
  if (!amenities || typeof amenities !== 'object') return []
  const a = amenities as Record<string, unknown>
  const out: string[] = []
  for (const [k, v] of Object.entries(a)) {
    if (!v || v === 'none' || v === false) continue
    const label = amenityLabel(k)
    if (label && !out.includes(label)) out.push(label)
  }
  return out
}
