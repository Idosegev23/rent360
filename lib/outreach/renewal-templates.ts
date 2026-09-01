/**
 * Template selection + variable builder for the renewal outreach flow.
 *
 * `renewal_leads` holds landlords whose listing came down roughly a year
 * ago and never came back — a candidate for "did the tenant just renew, or
 * are you about to go through this again?" outreach. This mirrors
 * `buildLandlordHookVariables` in `./personalization`, but a year-old
 * delisted listing has no meaningful images, room count, or availability
 * date, so none of those are required here.
 *
 * Address cleaning (`cleanCity`/`cleanStreet`) is imported from
 * `./personalization` rather than copied — that file backs the LIVE
 * landlord outreach path, and forking the regexes would let the two
 * dispatchers silently drift apart.
 */

import { supabaseService } from '../supabase'
import { sanitizeFirstName, type SanitizeResult } from './name-sanitize'
import { PersonalizationError, cleanCity, cleanStreet, type TemplateComponentForSend } from './personalization'

export type RenewalSegment = 'private_once' | 'repeat'

/** Active renewal template names. Env-overridable for future flips. */
export const RENEWAL_TEMPLATE_PRIVATE = process.env.RENEWAL_TEMPLATE_PRIVATE || 'landlord_renewal_private_v1'
export const RENEWAL_TEMPLATE_REPEAT = process.env.RENEWAL_TEMPLATE_REPEAT || 'landlord_renewal_repeat_v1'

export type RenewalVars = {
  first_name: string
  street_city: string
  times_listed: string
}

/**
 * Pure row -> vars transform, no DB access.
 *
 * `buildRenewalVariables` below is a thin query wrapper around this. A UI
 * that already has a page of `renewal_leads` rows joined to `properties`
 * (e.g. a 259-row send queue preview) should call this directly instead of
 * `buildRenewalVariables`, or it fires one query per row on every render.
 */
export function renewalVarsFromRow(
  row: { contact_name: string | null; street: string | null; address: string | null; city: string | null; neighborhood: string | null },
  timesListed: number,
): RenewalVars {
  const sanitized: SanitizeResult = sanitizeFirstName(row.contact_name, {
    city: row.city,
    neighborhood: row.neighborhood,
  })
  if (!sanitized.ok) throw new PersonalizationError(`name_invalid:${sanitized.reason}`)

  const streetRaw = row.street
    || (row.address ? row.address.split(',')[0]?.trim() : null)
    || row.neighborhood
    || row.city
  if (!streetRaw) throw new PersonalizationError('street_missing')

  const streetName = cleanStreet(streetRaw) || streetRaw.trim()
  const cityName = cleanCity(row.city) || (row.city ? row.city.trim() : '')
  const street_city = [streetName, cityName].filter(Boolean).join(', ') || streetName || cityName

  return {
    first_name: sanitized.firstName,
    street_city,
    times_listed: String(timesListed),
  }
}

/**
 * Pull renewal personalization vars for a property and validate.
 * Throws `PersonalizationError` on bad data: `phone_missing`,
 * `name_invalid:<reason>`, `street_missing`.
 */
export async function buildRenewalVariables(propertyId: string, timesListed: number): Promise<RenewalVars> {
  const sb = supabaseService()
  const { data: property, error } = await sb
    .from('properties')
    .select('id, contact_name, contact_phone, street, address, city, neighborhood')
    .eq('id', propertyId)
    .maybeSingle()

  if (error) throw new PersonalizationError('db_error', error.message)
  if (!property) throw new PersonalizationError('property_not_found')
  if (!property.contact_phone) throw new PersonalizationError('phone_missing')

  return renewalVarsFromRow(
    {
      contact_name: property.contact_name,
      street: property.street,
      address: property.address,
      city: property.city,
      neighborhood: property.neighborhood,
    },
    timesListed,
  )
}

/**
 * Pick the renewal template + build its components array.
 *
 * Both templates carry a TEXT header whose {{1}} is `street_city`. The
 * body params must match Meta's registered `param_names` exactly:
 *  - private_once → [first_name, street_city]
 *  - repeat       → [first_name, street_city, times_listed]
 */
export function pickRenewalTemplate(
  segment: RenewalSegment,
  vars: RenewalVars,
): { templateName: string; components: TemplateComponentForSend[] } {
  const headerComp: TemplateComponentForSend = {
    type: 'header',
    parameters: [{ type: 'text', text: vars.street_city }],
  }

  if (segment === 'repeat') {
    return {
      templateName: RENEWAL_TEMPLATE_REPEAT,
      components: [
        headerComp,
        {
          type: 'body',
          parameters: [
            { type: 'text', text: vars.first_name },
            { type: 'text', text: vars.street_city },
            { type: 'text', text: vars.times_listed },
          ],
        },
      ],
    }
  }

  return {
    templateName: RENEWAL_TEMPLATE_PRIVATE,
    components: [
      headerComp,
      {
        type: 'body',
        parameters: [
          { type: 'text', text: vars.first_name },
          { type: 'text', text: vars.street_city },
        ],
      },
    ],
  }
}

/**
 * Render the approved template's exact rendered message for a UI preview: the TEXT header
 * followed by the body, substituting {{1}}/{{2}}/{{3}} positionally in the segment's body-param
 * order.
 *
 * Both templates carry a Meta-registered TEXT header whose sole content is `{{1}}` = `street_city`
 * (confirmed against the Meta Graph API — the exact same value `pickRenewalTemplate`'s
 * `headerComp` sends, and the dispatcher DOES send that header component). A preview of the body
 * alone is therefore not "the exact rendered message" per spec §4 — the landlord's first line is
 * missing from what the operator reviews. Prepended here as its own line, set off from the body
 * by a rule, so it reads as a header rather than folding into the body's first line.
 *
 * `bodyTemplate` must be the live `body_template` from the `whatsapp_templates`
 * row — this function deliberately does not hardcode a second copy of the
 * Hebrew copy, since a hardcoded copy would silently drift from what Meta
 * actually sends and the operator would review one text while the landlord
 * receives another. The header line is built from `vars.street_city` (data, not copy) for the
 * same reason — never a hardcoded Hebrew string.
 */
export function renderRenewalPreview(bodyTemplate: string, vars: RenewalVars, segment: RenewalSegment): string {
  const params = segment === 'repeat'
    ? [vars.first_name, vars.street_city, vars.times_listed]
    : [vars.first_name, vars.street_city]

  const body = params.reduce<string>((text, value, idx) => text.split(`{{${idx + 1}}}`).join(value), bodyTemplate)

  const headerLine = vars.street_city
  const rule = '─'.repeat(Math.max(8, Math.min(32, headerLine.length)))
  return `${headerLine}\n${rule}\n${body}`
}
