/**
 * Phone-number helpers shared by the outreach dispatcher, the admin alerts,
 * and the env-var parser. Single source of truth for E.164 normalization.
 */

import { normalizePhone as normalize } from '../whatsapp/meta-provider'

export { normalize as normalizePhone }

/** Parse a comma-separated env var (e.g. ADMIN_ALERT_PHONES) into a deduped, normalized E.164 list. */
export function parsePhoneList(csv: string | undefined | null): string[] {
  if (!csv) return []
  const seen = new Set<string>()
  return csv
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(normalize)
    .filter(p => {
      if (seen.has(p)) return false
      seen.add(p)
      return /^\d{11,15}$/.test(p)
    })
}

export function isValidPhone(p: string | null | undefined): boolean {
  if (!p) return false
  return /^\d{11,15}$/.test(normalize(p))
}
