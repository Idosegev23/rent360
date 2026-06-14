import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { computeMatchesForProperty } from '../../../../../lib/matching/orchestrator'

/**
 * One-shot backfill: walks every approved_properties row and recomputes
 * matches against every renter. Guarded by CRON_SECRET so it's safe to
 * leave deployed. Designed for the initial bulk run after deploying the
 * matching engine, and as a periodic safety net.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })
  }

  const sb = supabaseService()
  const { data: approvedRows, error } = await sb
    .from('approved_properties')
    .select('property_id')
  if (error) return NextResponse.json({ error: { code: 'QUERY_FAILED', message: error.message } }, { status: 500 })

  const propertyIds = Array.from(new Set((approvedRows || []).map(r => r.property_id))).filter(Boolean) as string[]

  let processed = 0
  let totalRows = 0
  const errors: Array<{ property_id: string; error: string }> = []
  for (const pid of propertyIds) {
    try {
      const r = await computeMatchesForProperty(pid)
      processed += 1
      totalRows += r.inserted
    } catch (err) {
      errors.push({ property_id: pid, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return NextResponse.json({
    ok: true,
    properties_processed: processed,
    match_rows_upserted: totalRows,
    errors: errors.length ? errors : undefined,
  })
}

// Vercel Cron invokes the path with GET — delegate to the same CRON_SECRET-guarded logic so the
// nightly recompute self-heals any matches missed by the fire-and-forget compute on property approval.
export async function GET(req: NextRequest) {
  return POST(req)
}
