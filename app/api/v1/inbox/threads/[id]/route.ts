import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseService } from '../../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../../lib/auth'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })
  const orgId = user.org_id

  const { data: thread, error } = await sb
    .from('threads')
    .select('id, phone, status, channel, last_inbound_at, last_outbound_at, last_message_at, tags, property_id, opted_out_at, openai_response_id, ai_summary')
    .eq('id', params.id)
    .eq('org_id', orgId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: { code: 'QUERY_FAILED', message: error.message } }, { status: 500 })
  if (!thread) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })

  let property: any = null
  if (thread.property_id) {
    const { data } = await sb
      .from('properties')
      .select('id, title, city, neighborhood, address, street, price, rooms, sqm, images, contact_name, contact_phone, outreach_blocked, initial_message_sent')
      .eq('id', thread.property_id)
      .maybeSingle()
    property = data || null
  }

  const { data: messages } = await sb
    .from('messages')
    .select('id, direction, body, status, created_at, processed_at, meta_message_type, template_name, template_params, media_url, ai_metadata, external_id')
    .eq('thread_id', thread.id)
    .order('created_at', { ascending: true })
    .limit(500)

  // Render template messages to the actual text the client received (so the inbox shows the
  // content, not just "[תבנית: name]"). Map stored named params → the template's {{n}} slots.
  const list = messages || []
  const tplNames = Array.from(new Set(
    list.filter(m => m.meta_message_type === 'template' && !m.body && m.template_name).map(m => m.template_name as string)
  ))
  if (tplNames.length) {
    const { data: tpls } = await sb
      .from('whatsapp_templates')
      .select('name, body_template, param_names')
      .in('name', tplNames)
    const tplByName = new Map((tpls || []).map(t => [t.name, t]))
    for (const m of list as any[]) {
      if (m.meta_message_type !== 'template' || m.body || !m.template_name) continue
      const tpl = tplByName.get(m.template_name)
      if (!tpl?.body_template) continue
      const order: string[] = Array.isArray(tpl.param_names) ? (tpl.param_names as string[]) : []
      const vals = (m.template_params && typeof m.template_params === 'object') ? m.template_params as Record<string, unknown> : {}
      m.rendered_body = String(tpl.body_template).replace(/\{\{(\d+)\}\}/g, (_m, n: string) => {
        const key = order[Number(n) - 1]
        const v = key ? vals[key] : undefined
        return v != null && v !== '' ? String(v) : `{{${n}}}`
      })
    }
  }

  return NextResponse.json({
    thread,
    property,
    messages: list,
  })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })

  let body: { status?: string; assigned_to?: string | null } = {}
  try { body = await req.json() } catch {}
  const allowedStatus = new Set(['active', 'awaiting_reply', 'human_takeover', 'closed_won', 'closed_lost', 'opted_out', 'cooldown'])
  const update: Record<string, unknown> = {}
  if (body.status && allowedStatus.has(body.status)) update.status = body.status
  if (body.assigned_to !== undefined) update.assigned_to = body.assigned_to
  if (Object.keys(update).length === 0) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'no valid fields' } }, { status: 400 })

  const { error } = await sb
    .from('threads')
    .update(update)
    .eq('id', params.id)
    .eq('org_id', user.org_id)
  if (error) return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: error.message } }, { status: 500 })
  return NextResponse.json({ ok: true })
}
