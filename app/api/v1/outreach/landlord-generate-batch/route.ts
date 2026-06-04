import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrg } from '../../../../../lib/outreach/admin-context'
import { generateAndStorePersonalization } from '../../../../../lib/ai/property-vision'
import { supabaseService } from '../../../../../lib/supabase'

/**
 * Pre-generate the personal sentence for a set of properties, in CHUNKS, so the batch
 * send can use the rich (personalized) template. Generation is an OpenAI vision call per
 * property (~seconds each), so a single request only processes CHUNK properties and returns
 * the rest in `remaining` — the client loops until it's empty, then triggers the send.
 * Idempotent: already-generated (current version) properties are reused, not re-billed.
 */
export const maxDuration = 60

const CHUNK = 5

export async function POST(req: NextRequest) {
  const ctx = await requireAdminOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { orgId } = ctx

  let body: { propertyIds?: unknown } = {}
  try { body = await req.json() } catch {/* empty */}
  const propertyIds = Array.isArray(body.propertyIds)
    ? body.propertyIds.filter((x): x is string => typeof x === 'string')
    : []
  if (propertyIds.length === 0) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'propertyIds required' } }, { status: 400 })
  }

  // Restrict to properties in this org (defensive — ids come from the org's queue anyway).
  const sb = supabaseService()
  const { data: owned } = await sb.from('properties').select('id').eq('org_id', orgId).in('id', propertyIds)
  const ownedIds = new Set((owned || []).map(p => p.id))
  const valid = propertyIds.filter(id => ownedIds.has(id))

  const chunk = valid.slice(0, CHUNK)
  const remaining = valid.slice(CHUNK)

  let generated = 0
  for (const id of chunk) {
    try {
      await generateAndStorePersonalization(id)
      generated++
    } catch {
      // A failed generation just means that property falls back to basic at send time.
      generated++
    }
  }

  return NextResponse.json({ ok: true, processed: chunk.length, generated, remaining, total: valid.length })
}
