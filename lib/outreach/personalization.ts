/**
 * Build the personalization variables for the outreach template.
 *
 * No fabricated numbers — we currently don't have a renter pool, so the
 * template only uses `first_name` and `street`. Anything that requires
 * data we don't yet have is left out.
 */

import { supabaseService } from '../supabase'
import { sanitizeFirstName, type SanitizeResult } from './name-sanitize'
import { getPersonalizationFromMeta } from '../ai/property-vision'

export class PersonalizationError extends Error {
  reason: string
  constructor(reason: string, message?: string) {
    super(message || reason)
    this.name = 'PersonalizationError'
    this.reason = reason
  }
}

export type HookVariables = {
  first_name: string
  street: string
  city: string
  neighborhood: string | null
  cover_image_url: string | null
  recipient_phone: string
  street_city: string         // "ארלוזורוב, חיפה" — used for header + body var
  rooms_label: string         // "2" / "2.5" / "סטודיו" — falls back to "מספר"
  availability_label: string  // "מיידית" / "1/7/26" — has a default if missing
  personal_hook: string | null // The {{4}} in rich template. null → use basic template.
  hook_confidence: string | null // 'high' | 'medium' | 'low' — the generator's self-rating of the hook.
}

export type TemplateComponentForSend =
  | { type: 'header'; parameters: Array<{ type: 'text'; text: string } | { type: 'image'; image: { link: string } }> }
  | { type: 'body'; parameters: Array<{ type: 'text'; text: string }> }

/** Pull personalization vars for a property and validate. Throws PersonalizationError on bad data. */
export async function buildLandlordHookVariables(propertyId: string): Promise<HookVariables> {
  const sb = supabaseService()
  const { data: property, error } = await sb
    .from('properties')
    .select('id, contact_name, contact_phone, street, address, city, neighborhood, images, rooms, evacuation_date, available_from, scraped_metadata')
    .eq('id', propertyId)
    .maybeSingle()

  if (error) throw new PersonalizationError('db_error', error.message)
  if (!property) throw new PersonalizationError('property_not_found')

  if (!property.contact_phone) throw new PersonalizationError('phone_missing')

  const sanitized: SanitizeResult = sanitizeFirstName(property.contact_name, {
    city: property.city,
    neighborhood: property.neighborhood,
  })
  if (!sanitized.ok) throw new PersonalizationError(`name_invalid:${sanitized.reason}`)

  const street = property.street
    || (property.address ? property.address.split(',')[0]?.trim() : null)
    || property.neighborhood
    || property.city
  if (!street) throw new PersonalizationError('street_missing')

  // Images are no longer required (v2 templates use TEXT header, not IMAGE) —
  // they're still nice for the bot to attach later in the conversation, but
  // not a hard prerequisite for the first-touch message.
  const images: string[] = Array.isArray(property.images) ? property.images.filter((u): u is string => typeof u === 'string' && u.length > 0) : []
  const cover_image_url = images[0] || null

  // Header text: "ארלוזורוב, חיפה". Both header and body's {{3}} use this.
  const street_city = [street.trim(), property.city].filter(Boolean).join(', ')

  // Rooms label: number or "סטודיו". Falls back so we never send empty.
  const rooms_label = property.rooms !== null && property.rooms !== undefined
    ? (Number(property.rooms) === 1 ? '1' : String(property.rooms).replace(/\.0$/, ''))
    : ''
  if (!rooms_label) throw new PersonalizationError('rooms_missing')

  // Availability: prefer evacuation_date, fall back to available_from, then "מיידית".
  const dateStr = property.evacuation_date || property.available_from
  let availability_label = 'מיידית'
  if (dateStr) {
    try {
      const d = new Date(dateStr)
      if (!Number.isNaN(d.getTime())) {
        const day = String(d.getDate()).padStart(2, '0')
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const year = String(d.getFullYear()).slice(-2)
        availability_label = `${day}/${month}/${year}`
      }
    } catch {/* keep default */}
  }

  // Personal hook from vision/description/amenity pipeline (may be null).
  const personal_hook = getPersonalizationFromMeta(property.scraped_metadata)
  const ap = (property.scraped_metadata as any)?.ai_personalization
  const hook_confidence = ap && typeof ap.confidence === 'string' ? ap.confidence : null

  return {
    first_name: sanitized.firstName,
    street: street.trim(),
    city: property.city,
    neighborhood: property.neighborhood || null,
    cover_image_url,
    recipient_phone: property.contact_phone,
    street_city,
    rooms_label,
    availability_label,
    personal_hook,
    hook_confidence,
  }
}

/**
 * Pick the right template + build its components array.
 *
 *  - `landlord_outreach_v2_rich` when we have a vision/description-based
 *    personal hook (5 body params + 1 header param).
 *  - `landlord_outreach_v2_basic` when the hook is null (4 body params +
 *    1 header param). The body is otherwise identical.
 *
 * Header on both: TEXT with the address ("ארלוזורוב, חיפה").
 */
export type TemplateChoice = 'auto' | 'basic' | 'rich' | 'auto_quality'

/** Confidence levels accepted as "good enough" for the rich template in batch quality mode. */
const RICH_OK_CONFIDENCE = (process.env.OUTREACH_RICH_MIN_CONFIDENCE || 'high,medium')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

/**
 * Decide whether the rich (personalized) template applies.
 *  - basic        → never rich.
 *  - rich         → rich whenever a hook exists (explicit manual pick).
 *  - auto_quality → rich only when the hook's confidence is trustworthy (batch fallback to basic).
 *  - auto         → rich whenever a hook exists (legacy default).
 */
export function shouldUseRich(vars: HookVariables, mode: TemplateChoice = 'auto'): boolean {
  if (mode === 'basic') return false
  if (!vars.personal_hook) return false
  if (mode === 'rich') return true
  if (mode === 'auto_quality') return RICH_OK_CONFIDENCE.includes((vars.hook_confidence || '').toLowerCase())
  return true
}

export function pickTemplateAndComponents(vars: HookVariables, mode: TemplateChoice = 'auto'): {
  templateName: string
  components: TemplateComponentForSend[]
} {
  const headerComp: TemplateComponentForSend = {
    type: 'header',
    parameters: [{ type: 'text', text: vars.street_city }],
  }

  if (shouldUseRich(vars, mode)) {
    // RICH: name, rooms, address, hook, availability
    return {
      templateName: 'landlord_outreach_v2_rich',
      components: [
        headerComp,
        {
          type: 'body',
          parameters: [
            { type: 'text', text: vars.first_name },
            { type: 'text', text: vars.rooms_label },
            { type: 'text', text: vars.street_city },
            { type: 'text', text: vars.personal_hook! },
            { type: 'text', text: vars.availability_label },
          ],
        },
      ],
    }
  }
  // BASIC: name, rooms, address, availability
  return {
    templateName: 'landlord_outreach_v2_basic',
    components: [
      headerComp,
      {
        type: 'body',
        parameters: [
          { type: 'text', text: vars.first_name },
          { type: 'text', text: vars.rooms_label },
          { type: 'text', text: vars.street_city },
          { type: 'text', text: vars.availability_label },
        ],
      },
    ],
  }
}

/** @deprecated kept for backward compat — use pickTemplateAndComponents instead */
export function hookVariablesToTemplateComponents(vars: HookVariables): TemplateComponentForSend[] {
  return pickTemplateAndComponents(vars).components
}
