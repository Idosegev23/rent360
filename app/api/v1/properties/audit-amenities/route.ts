import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { extractAmenitiesFromText, extractAmenitiesFromTextWithEvidence, type AmenityKey } from '../../../../../lib/data/extract-amenities-from-text'

/**
 * One-shot audit: for every approved property, scan its text fields and check
 * whether the stored amenities flags match what the description actually says.
 * Returns a per-property diff. With `?apply=true` it writes the inferred
 * amenities back to the property (only adding/fixing fields where the text
 * gives a clear signal — silent fields are left untouched).
 *
 *   GET  /api/v1/properties/audit-amenities             → report only
 *   GET  /api/v1/properties/audit-amenities?apply=true  → also write corrections
 *
 * Guarded by CRON_SECRET so it's safe to leave deployed.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })
  }

  const apply = req.nextUrl.searchParams.get('apply') === 'true'
  const evidence = req.nextUrl.searchParams.get('evidence') === 'true'
  const onlyKey = req.nextUrl.searchParams.get('key') as AmenityKey | null
  const sb = supabaseService()

  const { data: approved, error: aerr } = await sb
    .from('approved_properties')
    .select('property_id')
  if (aerr) return NextResponse.json({ error: { code: 'QUERY_FAILED', message: aerr.message } }, { status: 500 })
  const propertyIds = Array.from(new Set((approved || []).map(r => r.property_id))).filter(Boolean) as string[]
  if (propertyIds.length === 0) return NextResponse.json({ ok: true, properties: [] })

  const { data: properties, error: perr } = await sb
    .from('properties')
    .select('id, title, description, full_text, amenities')
    .in('id', propertyIds)
  if (perr) return NextResponse.json({ error: { code: 'QUERY_FAILED', message: perr.message } }, { status: 500 })

  const report: Array<{
    id: string
    title: string
    mismatches: Array<{ key: AmenityKey; stored: boolean | undefined; detected: boolean }>
    additions: Array<{ key: AmenityKey; detected: boolean }>
    applied?: boolean
  }> = []

  const evidenceMap = evidence
    ? new Map<string, ReturnType<typeof extractAmenitiesFromTextWithEvidence>>()
    : null

  for (const p of properties || []) {
    const stored = (p.amenities && typeof p.amenities === 'object')
      ? p.amenities as Record<string, any>
      : {}
    const detected = extractAmenitiesFromText([p.title, p.description, p.full_text])
    if (evidenceMap) evidenceMap.set(p.id, extractAmenitiesFromTextWithEvidence([p.title, p.description, p.full_text]))

    const mismatches: Array<{ key: AmenityKey; stored: boolean | undefined; detected: boolean; snippet?: string | null }> = []
    const additions: Array<{ key: AmenityKey; detected: boolean; snippet?: string | null }> = []
    const patch: Record<string, boolean> = {}

    for (const [k, v] of Object.entries(detected)) {
      if (v === null) continue
      const key = k as AmenityKey
      if (onlyKey && key !== onlyKey) continue
      const storedVal = stored[key]
      const snippet = evidenceMap?.get(p.id)?.[key]?.snippet ?? null
      if (storedVal === undefined) {
        const row: typeof additions[number] = { key, detected: v }
        if (evidence) row.snippet = snippet
        additions.push(row)
        patch[key] = v
      } else if (storedVal !== v) {
        const row: typeof mismatches[number] = { key, stored: storedVal, detected: v }
        if (evidence) row.snippet = snippet
        mismatches.push(row)
        patch[key] = v
      }
    }

    let applied = false
    if (apply && Object.keys(patch).length > 0) {
      const merged = { ...stored, ...patch }
      const { error: uerr } = await sb.from('properties').update({ amenities: merged }).eq('id', p.id)
      if (!uerr) applied = true
    }

    if (mismatches.length > 0 || additions.length > 0) {
      const row: typeof report[number] = {
        id: p.id,
        title: p.title || '(ללא כותרת)',
        mismatches,
        additions,
      }
      if (apply) row.applied = applied
      report.push(row)
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: properties?.length || 0,
    rows_with_changes: report.length,
    applied: apply,
    properties: report,
  })
}
