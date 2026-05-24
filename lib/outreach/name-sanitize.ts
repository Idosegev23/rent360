/**
 * Sanitize a scraped landlord name.
 *
 * Scraped `contact_name` values include things like "תיווך משה", "דירה
 * להשכרה", "עו״ד יוסי", phone numbers, address fragments. We must reject
 * these so we never greet a landlord with "תיווך משה, היי 👋" — that one
 * mistake torches the bot's credibility in a single message.
 *
 * Returns the rejection reason instead of throwing so the caller can both
 * log it (on `properties.outreach_skip_reason`) and show a friendly tooltip
 * in the UI.
 */

const BLOCKLIST = new Set([
  'תיווך', 'מתווך', 'מתווכת', 'תיווכים', 'תיווכים.',
  'דירה', 'דירת', 'דירות', 'יחידה', 'יחידת', 'דירה.',
  'להשכרה', 'להשכיר', 'משכיר', 'משכירה',
  'בעל', 'בעלים', 'בעלת', 'בעלה',
  'אמא', 'אבא', 'הורה', 'הורים',
  'עו"ד', 'עו״ד', 'עוד', 'עוה"ד', 'עוה״ד',
  'לא', 'אל', 'אין', 'כן',
  'קונטקט', 'איש', 'מספר', 'טלפון', 'נייד',
  'שלום', 'הי', 'היי',
  'mr', 'mrs', 'ms', 'private', 'unknown',
  'admin', 'support', 'office',
])

export type SanitizeResult =
  | { ok: true; firstName: string }
  | { ok: false; reason: string }

const HEBREW_OR_LATIN = /^[א-תװ-ײA-Za-z'׳']{2,12}$/

export function sanitizeFirstName(rawName: string | null | undefined, opts?: {
  city?: string | null
  neighborhood?: string | null
}): SanitizeResult {
  if (!rawName || typeof rawName !== 'string') {
    return { ok: false, reason: 'name_empty' }
  }
  let name = rawName.normalize('NFC').trim()
  if (!name) return { ok: false, reason: 'name_empty' }

  // Strip leading/trailing punctuation
  name = name.replace(/^[\s,.\-_/\\|:;!?'"׳״()[\]{}@#$%^&*+=<>~`]+/, '')
              .replace(/[\s,.\-_/\\|:;!?'"׳״()[\]{}@#$%^&*+=<>~`]+$/, '')

  // First whitespace-delimited token
  const token = name.split(/\s+/)[0] || ''
  if (!token) return { ok: false, reason: 'name_empty_after_trim' }

  if (token.length < 2) return { ok: false, reason: 'name_too_short' }
  if (token.length > 12) return { ok: false, reason: 'name_too_long' }

  // Character class — Hebrew or Latin letters + apostrophe variants only
  if (!HEBREW_OR_LATIN.test(token)) return { ok: false, reason: 'name_bad_chars' }

  const lowered = token.toLowerCase()
  if (BLOCKLIST.has(lowered) || BLOCKLIST.has(token)) {
    return { ok: false, reason: 'name_blocklisted' }
  }

  // Reject if the token equals a city or neighborhood (people sometimes paste an address there)
  const city = opts?.city?.trim()
  const neighborhood = opts?.neighborhood?.trim()
  if (city && token === city) return { ok: false, reason: 'name_is_city' }
  if (neighborhood && token === neighborhood) return { ok: false, reason: 'name_is_neighborhood' }

  return { ok: true, firstName: token }
}
