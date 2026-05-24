import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseService } from '../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../lib/auth'
import { embedPropertyIfChanged } from '../../../../../lib/ai/embeddings'

// One-shot backfill: embed every property in the user's org that doesn't yet
// have an embedding. Idempotent — re-runs skip already-embedded rows.
//
// Designed for admin use after the initial Sheet import and after migration 0005.
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
  const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '50'), 200))

  const { data: properties, error } = await sb
    .from('properties')
    .select('id, title')
    .eq('org_id', orgId)
    .is('embedding', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) return NextResponse.json({ error: { code: 'QUERY_FAILED', message: error.message } }, { status: 500 })

  let embedded = 0
  let skipped = 0
  const errors: Array<{ id: string; error: string }> = []
  for (const p of properties || []) {
    try {
      const res = await embedPropertyIfChanged(p.id)
      if (res.embedded) embedded++
      else skipped++
    } catch (err) {
      errors.push({ id: p.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return NextResponse.json({
    ok: true,
    total: properties?.length || 0,
    embedded,
    skipped,
    errors: errors.length ? errors : undefined,
    note: properties && properties.length === limit
      ? `Hit batch limit of ${limit}. Re-run to process more.`
      : undefined,
  })
}
