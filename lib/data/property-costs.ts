/**
 * Running costs of a rental and the labels the property forms/cards share.
 * `price_includes` is stored as a jsonb array of the keys below.
 */
export const PRICE_INCLUDES_OPTIONS = [
  { key: 'arnona', label: 'ארנונה' },
  { key: 'vaad_bayit', label: 'ועד בית' },
  { key: 'water', label: 'מים' },
  { key: 'electricity', label: 'חשמל' },
  { key: 'gas', label: 'גז' },
  { key: 'internet', label: 'אינטרנט' },
] as const

export type PriceIncludesKey = typeof PRICE_INCLUDES_OPTIONS[number]['key']

/** Property condition as a fixed choice (matches the renter questionnaire's renovated / good / needs-work). */
export const CONDITION_OPTIONS = [
  { value: 'דירה חדשה', label: 'דירה חדשה' },
  { value: 'משופצת', label: 'משופצת' },
  { value: 'במצב שמור', label: 'במצב שמור' },
  { value: 'דורשת שיפוץ', label: 'דורשת שיפוץ' },
] as const

const LABEL_BY_KEY: Record<string, string> = Object.fromEntries(PRICE_INCLUDES_OPTIONS.map(o => [o.key, o.label]))

/** Normalises whatever the column holds (array, JSON string, null) to known keys only. */
export function normalizePriceIncludes(v: unknown): PriceIncludesKey[] {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? safeParse(v) : []
  return arr.filter((k): k is PriceIncludesKey => typeof k === 'string' && k in LABEL_BY_KEY)
}

function safeParse(s: string): unknown[] {
  try { const p = JSON.parse(s); return Array.isArray(p) ? p : [] } catch { return [] }
}

export function priceIncludesLabel(v: unknown): string {
  return normalizePriceIncludes(v).map(k => LABEL_BY_KEY[k]).join(', ')
}
