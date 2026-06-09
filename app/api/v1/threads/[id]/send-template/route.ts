import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseService } from '../../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../../lib/auth'
import { sendTemplate } from '../../../../../../lib/whatsapp/meta-provider'

/**
 * Send an APPROVED template into a thread — to manage the conversation even after the 24h
 * window closed (free text is blocked then; an approved template is allowed).
 *
 * GET  → list approved templates (name, body_template, param_names) for the picker.
 * POST { template_name, params: string[] } → render + send (body params) + record the message.
 */
async function auth() {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return null
  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id, name').eq('id', userId).maybeSingle()
  if (!user) return null
  return { sb, userId, orgId: user.org_id, name: user.name as string | null }
}

export async function GET() {
  const a = await auth()
  if (!a) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { data } = await a.sb
    .from('whatsapp_templates')
    .select('name, body_template, param_names, category')
    .eq('status', 'approved')
    .order('name')
  return NextResponse.json({ templates: data || [] })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const a = await auth()
  if (!a) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { sb, userId, orgId, name } = a

  let body: { template_name?: string; params?: unknown } = {}
  try { body = await req.json() } catch {/* empty */}
  const templateName = String(body.template_name || '')
  const paramVals = Array.isArray(body.params) ? body.params.map(v => String(v ?? '')) : []
  if (!templateName) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'template_name required' } }, { status: 400 })

  const { data: thread } = await sb
    .from('threads').select('id, org_id, phone, status').eq('id', params.id).eq('org_id', orgId).maybeSingle()
  if (!thread) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
  if (!thread.phone) return NextResponse.json({ error: { code: 'NO_PHONE' } }, { status: 422 })

  const { data: tpl } = await sb
    .from('whatsapp_templates').select('name, body_template, param_names, status').eq('name', templateName).maybeSingle()
  if (!tpl) return NextResponse.json({ error: { code: 'TEMPLATE_MISSING' } }, { status: 404 })
  if (tpl.status !== 'approved') return NextResponse.json({ error: { code: 'TEMPLATE_NOT_APPROVED', message: `התבנית בסטטוס ${tpl.status}` } }, { status: 422 })

  const order: string[] = Array.isArray(tpl.param_names) ? (tpl.param_names as string[]) : []
  const components = paramVals.length
    ? [{ type: 'body' as const, parameters: paramVals.map(t => ({ type: 'text' as const, text: t.slice(0, 200) })) }]
    : []

  let sent
  try {
    sent = await sendTemplate({ to: thread.phone, name: templateName, language: 'he', components: components as any })
  } catch (err) {
    return NextResponse.json({ error: { code: 'META_SEND_FAILED', message: err instanceof Error ? err.message : String(err) } }, { status: 502 })
  }

  // Rendered text (for the inbox bubble): substitute {{n}} with the provided params.
  const rendered = String(tpl.body_template || '').replace(/\{\{(\d+)\}\}/g, (_m, n: string) => paramVals[Number(n) - 1] ?? `{{${n}}}`)
  const tparams: Record<string, string> = {}
  order.forEach((k, i) => { if (paramVals[i] != null) tparams[k] = paramVals[i] })

  await sb.from('messages').insert({
    org_id: orgId, thread_id: thread.id, channel: 'whatsapp', direction: 'out',
    body: rendered || null, status: 'sent', external_id: sent.messageId,
    meta_message_type: 'template', template_name: templateName, template_params: tparams,
    metadata: { sent_by_user_id: userId, sent_by_name: name },
  })
  const now = new Date().toISOString()
  await sb.from('threads').update({ last_outbound_at: now, last_message_at: now }).eq('id', thread.id)

  return NextResponse.json({ ok: true, message_id: sent.messageId })
}
