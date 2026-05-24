import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseService } from '../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../lib/auth'
import { improveText, type ImproveKind } from '../../../../../lib/ai/text-improve'

/**
 * Polish a raw Hebrew property description / title via gpt-5.4.
 * Backed by `lib/ai/text-improve.ts` which is also called server-side by
 * `manual-add` to auto-clean descriptions before they hit the DB.
 */

export async function POST(req: NextRequest) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })

  let body: { text?: string; kind?: ImproveKind } = {}
  try { body = await req.json() } catch {}
  const text = (body.text || '').trim()
  if (!text) return NextResponse.json({ error: { code: 'EMPTY' } }, { status: 400 })
  if (text.length > 4000) return NextResponse.json({ error: { code: 'TOO_LONG', message: 'מקסימום 4000 תווים' } }, { status: 422 })

  try {
    const improved = await improveText(text, body.kind || 'description')
    return NextResponse.json({ ok: true, improved })
  } catch (err) {
    return NextResponse.json({
      error: { code: 'AI_FAILED', message: err instanceof Error ? err.message : String(err) },
    }, { status: 502 })
  }
}
