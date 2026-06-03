import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { requireAdminOrg } from '../../../../../lib/outreach/admin-context'
import { buildLandlordHookVariables, PersonalizationError } from '../../../../../lib/outreach/personalization'
import { generateAndStorePersonalization } from '../../../../../lib/ai/property-vision'

/**
 * Real rendered preview of both landlord templates for a property, so the admin can
 * see exactly what will be sent (including the personal sentence) and choose manually.
 * Renders from the live body_template in the DB so the copy never drifts.
 *
 * Query: ?propertyId=...
 */
function render(template: string, values: string[]): string {
  return template.replace(/\{\{(\d+)\}\}/g, (_m, n) => values[Number(n) - 1] ?? '')
}

export async function GET(req: NextRequest) {
  const ctx = await requireAdminOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const propertyId = req.nextUrl.searchParams.get('propertyId')
  if (!propertyId) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'propertyId required' } }, { status: 400 })

  let vars
  try {
    vars = await buildLandlordHookVariables(propertyId)
  } catch (e) {
    if (e instanceof PersonalizationError) {
      return NextResponse.json({ eligible: false, reason: e.reason })
    }
    throw e
  }

  // No personal sentence yet → generate one on-demand (model call), then rebuild vars.
  if (!vars.personal_hook) {
    try {
      await generateAndStorePersonalization(propertyId)
      vars = await buildLandlordHookVariables(propertyId)
    } catch {
      // keep basic-only if the model is unavailable
    }
  }

  const sb = supabaseService()
  const { data: tpls } = await sb
    .from('whatsapp_templates')
    .select('name, body_template')
    .in('name', ['landlord_outreach_v2_basic', 'landlord_outreach_v2_rich'])
  const bodyByName = new Map<string, string>()
  for (const t of tpls || []) bodyByName.set(t.name, t.body_template || '')

  const header = `דירה ב${vars.street_city}`

  const basicBody = render(bodyByName.get('landlord_outreach_v2_basic') || '', [
    vars.first_name, vars.rooms_label, vars.street_city, vars.availability_label,
  ])
  const richBody = vars.personal_hook
    ? render(bodyByName.get('landlord_outreach_v2_rich') || '', [
        vars.first_name, vars.rooms_label, vars.street_city, vars.personal_hook, vars.availability_label,
      ])
    : null

  return NextResponse.json({
    eligible: true,
    contactName: vars.first_name,
    hook: vars.personal_hook,
    hookConfidence: vars.hook_confidence,
    footer: 'לא רלוונטי? כתבו "להסיר"',
    buttons: ['כן, ספרו לי עוד', 'להסיר אותי'],
    basic: { header, body: basicBody },
    rich: richBody ? { header, body: richBody } : null,
  })
}
