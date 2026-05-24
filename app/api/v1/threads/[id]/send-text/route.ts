import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseService } from '../../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../../lib/auth'
import { sendText } from '../../../../../../lib/whatsapp/meta-provider'
import { isInSessionWindow } from '../../../../../../lib/whatsapp/window-guard'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id, name').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })

  let body: { text?: string } = {}
  try { body = await req.json() } catch {}
  const text = (body.text || '').trim()
  if (!text) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'text required' } }, { status: 400 })
  if (text.length > 4096) return NextResponse.json({ error: { code: 'TOO_LONG', message: 'text > 4096' } }, { status: 422 })

  const { data: thread } = await sb
    .from('threads')
    .select('id, org_id, phone, status, last_inbound_at')
    .eq('id', params.id)
    .eq('org_id', user.org_id)
    .maybeSingle()
  if (!thread) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
  if (!thread.phone) return NextResponse.json({ error: { code: 'NO_PHONE' } }, { status: 422 })

  if (!isInSessionWindow(thread.last_inbound_at)) {
    return NextResponse.json({
      error: { code: 'WINDOW_CLOSED', message: 'חלון 24 שעות נסגר, נדרשת תבנית מאושרת' },
    }, { status: 422 })
  }

  let sent
  try {
    sent = await sendText(thread.phone, text)
  } catch (err) {
    return NextResponse.json({
      error: { code: 'META_SEND_FAILED', message: err instanceof Error ? err.message : String(err) },
    }, { status: 502 })
  }

  await sb.from('messages').insert({
    org_id: thread.org_id,
    thread_id: thread.id,
    channel: 'whatsapp',
    direction: 'out',
    body: text,
    status: 'sent',
    external_id: sent.messageId,
    meta_message_type: 'text',
    metadata: { sent_by_user_id: userId, sent_by_name: user.name },
  })

  const now = new Date().toISOString()
  await sb.from('threads').update({
    last_outbound_at: now,
    last_message_at: now,
  }).eq('id', thread.id)

  return NextResponse.json({ ok: true, message_id: sent.messageId })
}
