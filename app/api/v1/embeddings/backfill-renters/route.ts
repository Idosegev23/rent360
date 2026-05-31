import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { embedRenterIfChanged } from '../../../../../lib/ai/embeddings'

/**
 * One-shot backfill: walks every renter with notes worth embedding and
 * fills `renters.notes_embedding`. Idempotent — `embedRenterIfChanged`
 * hashes the source text and skips when nothing changed since last run.
 * Guarded by CRON_SECRET so it's safe to leave deployed.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })
  }

  const sb = supabaseService()
  const { data: renters, error } = await sb
    .from('renters')
    .select('id')
    .order('created_at', { ascending: true })
  if (error) {
    return NextResponse.json({ error: { code: 'QUERY_FAILED', message: error.message } }, { status: 500 })
  }

  let embedded = 0
  let skipped = 0
  const errors: Array<{ renter_id: string; error: string }> = []
  for (const r of renters || []) {
    try {
      const res = await embedRenterIfChanged(r.id)
      if (res.embedded) embedded += 1
      else skipped += 1
    } catch (err) {
      errors.push({ renter_id: r.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: renters?.length || 0,
    embedded,
    skipped,
    errors,
  })
}
