import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseService } from '../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../lib/auth'
import { extractPropertyFromText } from '../../../../../lib/ai/extract-property'

export async function POST(req: NextRequest) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })

  let body: { text?: string } = {}
  try { body = await req.json() } catch {}
  const text = (body.text || '').trim()
  if (!text) return NextResponse.json({ error: { code: 'EMPTY' } }, { status: 400 })
  if (text.length > 8000) return NextResponse.json({ error: { code: 'TOO_LONG', message: 'מקסימום 8000 תווים' } }, { status: 422 })
  if (text.length < 15) return NextResponse.json({ error: { code: 'TOO_SHORT', message: 'הטקסט קצר מדי לחילוץ' } }, { status: 422 })

  try {
    const { data, rawJson } = await extractPropertyFromText(text)
    const fieldCount = countExtractedFields(data)
    return NextResponse.json({ ok: true, data, fieldCount, rawJson })
  } catch (err) {
    return NextResponse.json({
      error: { code: 'EXTRACT_FAILED', message: err instanceof Error ? err.message : String(err) },
    }, { status: 502 })
  }
}

function countExtractedFields(data: any): number {
  if (!data || typeof data !== 'object') return 0
  let n = 0
  for (const k of Object.keys(data)) {
    const v = data[k]
    if (v === undefined || v === null || v === '') continue
    if (k === 'amenities' && typeof v === 'object') {
      n += Object.keys(v).length
    } else {
      n += 1
    }
  }
  return n
}
