/**
 * Build the personalization variables for the outreach template.
 *
 * No fabricated numbers — we currently don't have a renter pool, so the
 * template only uses `first_name` and `street`. Anything that requires
 * data we don't yet have is left out.
 */

import { supabaseService } from '../supabase'
import { sanitizeFirstName, type SanitizeResult } from './name-sanitize'

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
}

export type TemplateComponentForSend =
  | { type: 'header'; parameters: Array<{ type: 'image'; image: { link: string } }> }
  | { type: 'body'; parameters: Array<{ type: 'text'; text: string }> }

/** Pull personalization vars for a property and validate. Throws PersonalizationError on bad data. */
export async function buildLandlordHookVariables(propertyId: string): Promise<HookVariables> {
  const sb = supabaseService()
  const { data: property, error } = await sb
    .from('properties')
    .select('id, contact_name, contact_phone, street, address, city, neighborhood, images')
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

  // Cover image: first non-empty URL. We REQUIRE one — the approved template
  // declares an IMAGE header at Meta, so every send must include an image
  // parameter. Properties without any photo stay out of the outreach pool
  // until at least one image is attached (admin must fill manually).
  const images: string[] = Array.isArray(property.images) ? property.images.filter((u): u is string => typeof u === 'string' && u.length > 0) : []
  const cover_image_url = images[0] || null
  if (!cover_image_url) throw new PersonalizationError('no_images')

  return {
    first_name: sanitized.firstName,
    street: street.trim(),
    city: property.city,
    neighborhood: property.neighborhood || null,
    cover_image_url,
    recipient_phone: property.contact_phone,
  }
}

/**
 * Turn HookVariables into the Meta `components` array for landlord_outreach_v1.
 * Header is included only when a cover image is available — when the template
 * is submitted to Meta you must declare it with a HEADER of type IMAGE, but
 * at send-time you can omit the header components if you don't have one.
 *
 * Important: this works only after the Meta template has been approved with
 * the image header. We register two variants in `whatsapp_templates`:
 * `landlord_outreach_v1` (with image header) and a fallback for image-less
 * properties; the caller picks based on `cover_image_url`.
 */
export function hookVariablesToTemplateComponents(vars: HookVariables): TemplateComponentForSend[] {
  const components: TemplateComponentForSend[] = []
  if (vars.cover_image_url) {
    components.push({
      type: 'header',
      parameters: [{ type: 'image', image: { link: vars.cover_image_url } }],
    })
  }
  components.push({
    type: 'body',
    parameters: [
      { type: 'text', text: vars.first_name },
      { type: 'text', text: vars.street },
    ],
  })
  return components
}
