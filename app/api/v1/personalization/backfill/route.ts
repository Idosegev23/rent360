import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseService } from '../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../lib/auth'
import { generateAndStorePersonalization } from '../../../../../lib/ai/property-vision'

// Backfill the personalization line ({{6}} for landlord_outreach_v2_rich)
// over all currently-approved properties that don't yet have one.
// Idempotent — re-runs skip properties that already have a line.
export async function POST(req: NextRequest) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id, role').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })
  if (user.role !== 'admin' && user.role !== 'owner') {
    return NextResponse.json({ error: { code: 'FORBIDDEN' } }, { status: 403 })
  }

  const orgId = user.org_id
  const url = new URL(req.url)
  const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '50'), 100))
  const force = url.searchParams.get('force') === 'true'

  const { data: approvedRows, error: appErr } = await sb
    .from('approved_properties')
    .select('property_id')
    .eq('org_id', orgId)
  if (appErr) return NextResponse.json({ error: { code: 'QUERY_FAILED', message: appErr.message } }, { status: 500 })
  const approvedIds = (approvedRows || []).map(r => r.property_id).filter(Boolean) as string[]
  if (approvedIds.length === 0) {
    return NextResponse.json({ ok: true, total: 0, generated: 0, skipped: 0, note: 'no approved properties' })
  }

  // Pull just the IDs, then call generator one by one. The generator itself
  // checks scraped_metadata.ai_personalization and skips if present.
  const { data: properties, error: propErr } = await sb
    .from('properties')
    .select('id, scraped_metadata')
    .eq('org_id', orgId)
    .in('id', approvedIds)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (propErr) return NextResponse.json({ error: { code: 'QUERY_FAILED', message: propErr.message } }, { status: 500 })

  let generated = 0
  let existing = 0
  let nullResult = 0
  const errors: Array<{ id: string; error: string }> = []
  for (const p of properties || []) {
    // If force=true, blow away existing personalization first
    if (force) {
      const meta: any = p.scraped_metadata && typeof p.scraped_metadata === 'object' ? { ...(p.scraped_metadata as any) } : {}
      delete meta.ai_personalization
      await sb.from('properties').update({ scraped_metadata: meta }).eq('id', p.id)
    }
    try {
      const result = await generateAndStorePersonalization(p.id)
      if (result.generated) generated++
      else if (result.existing) existing++
      else nullResult++
    } catch (err) {
      errors.push({ id: p.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return NextResponse.json({
    ok: true,
    total: properties?.length || 0,
    generated,
    existing_skipped: existing,
    null_result: nullResult,
    errors: errors.length ? errors : undefined,
    note: properties && properties.length === limit ? `batch limit ${limit}; re-run for more` : undefined,
  })
}
