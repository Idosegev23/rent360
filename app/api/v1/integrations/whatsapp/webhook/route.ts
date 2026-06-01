import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../../lib/supabase'
import {
  parseInboundWebhook,
  verifyWebhookSignature,
  markRead,
  downloadMedia,
  sendText,
  normalizePhone,
  type InboundMessage,
} from '../../../../../../lib/whatsapp/meta-provider'
import { isHardOptOut, isSuppressed, recordOptOut } from '../../../../../../lib/outreach/suppression'
import { processThreadIfNotLocked } from '../../../../../../lib/ai/conversation-orchestrator'
import { embedInBackground, embedMessage } from '../../../../../../lib/ai/embeddings'

// Meta calls this endpoint when configuring the webhook (verification handshake).
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  const expected = process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN

  if (mode === 'subscribe' && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('forbidden', { status: 403 })
}

// Meta calls this with inbound messages + delivery/read status updates.
// Must respond 200 within ~5s or Meta retries.
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-hub-signature-256')

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: { code: 'BAD_SIGNATURE' } }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: { code: 'BAD_JSON' } }, { status: 400 })
  }

  const sb = supabaseService()
  const events = parseInboundWebhook(payload)

  // Process events sequentially per-event but don't block the HTTP response on the
  // full coalesce window. The orchestrator's atomic claim handles concurrent invocations.
  void Promise.allSettled(events.map(e => processEvent(sb, e, payload)))

  return NextResponse.json({ received: true, events: events.length })
}

async function processEvent(
  sb: ReturnType<typeof supabaseService>,
  event: ReturnType<typeof parseInboundWebhook>[number],
  rawPayload: unknown,
) {
  try {
    if (event.kind === 'status') {
      await sb
        .from('messages')
        .update({ status: event.status.status, metadata: event.status.raw as any })
        .eq('external_id', event.status.externalId)
      return
    }

    const m = event.message

    // Resolve org (single-tenant for now).
    const { data: org } = await sb.from('organizations').select('id').limit(1).single()
    if (!org) return
    const orgId = org.id

    // Idempotency on Meta's wamid
    const { data: dup } = await sb
      .from('messages')
      .select('id')
      .eq('external_id', m.externalId)
      .maybeSingle()
    if (dup) return

    // Audit log
    try {
      await sb.from('inbound_events').insert({
        org_id: orgId,
        endpoint: '/api/v1/integrations/whatsapp/webhook',
        payload: rawPayload as any,
        idempotency_key: m.externalId,
        status: 'received',
        source_id: m.from,
      })
    } catch {/* dup key fine */}

    // Resolve thread
    const thread = await upsertThread(sb, orgId, m.from)

    // Handle media: download from Meta, upload to Supabase Storage, capture public URL
    let mediaUrl: string | null = null
    if (m.type === 'image' && m.mediaId) {
      try {
        const { buffer, mimeType } = await downloadMedia(m.mediaId)
        const ext = mimeType.split('/')[1] || 'jpg'
        const path = `${thread.id}/${m.externalId}.${ext}`
        const { error: upErr } = await sb.storage
          .from('whatsapp-inbound-media')
          .upload(path, buffer, { contentType: mimeType, upsert: true })
        if (!upErr) {
          const { data: pub } = sb.storage.from('whatsapp-inbound-media').getPublicUrl(path)
          mediaUrl = pub?.publicUrl || null
        }
      } catch (err) {
        console.error('[webhook] media download/upload failed:', err)
      }
    }

    // Persist inbound message
    const { data: msgRow } = await sb.from('messages').insert({
      org_id: orgId,
      thread_id: thread.id,
      channel: 'whatsapp',
      direction: 'in',
      body: m.text || null,
      status: 'received',
      external_id: m.externalId,
      meta_message_type: m.type,
      media_url: mediaUrl,
      metadata: m.raw as any,
    }).select('id').single()

    // Open / extend the 24h window
    const inboundAt = new Date(m.timestamp * 1000).toISOString()
    await sb.from('threads').update({
      last_inbound_at: inboundAt,
      last_message_at: inboundAt,
      phone: normalizePhone(m.from),
      channel: 'whatsapp',
    }).eq('id', thread.id)

    // Background embed of the inbound text (cheap, async)
    if (msgRow?.id && m.text) {
      embedInBackground(() => embedMessage(msgRow.id), `in:${msgRow.id}`)
    }

    // Mark Meta message as read
    markRead(m.externalId)

    // ---- Opt-out shortcuts (skip AI) ----

    // 1. Interactive button: id='optout_v1'
    if (m.type === 'interactive' && m.interactive?.id === 'optout_v1') {
      await recordOptOut({ orgId, phone: m.from, source: 'button', reason: 'tapped opt-out button' })
      try {
        await sendText(m.from, 'בסדר, לא נשלח עוד הודעות. תודה! 🙂')
      } catch {/* ignore */}
      if (msgRow?.id) await sb.from('messages').update({ processed_at: new Date().toISOString() }).eq('id', msgRow.id)
      return
    }

    // 2. Hard stop-word match — plain text OR a template quick-reply button.
    //    Tapping the "להסיר אותי" button on landlord_outreach_* arrives as a
    //    `button` message (m.text = button label), so we must check both types.
    if ((m.type === 'text' || m.type === 'button') && isHardOptOut(m.text)) {
      await recordOptOut({
        orgId,
        phone: m.from,
        source: m.type === 'button' ? 'button' : 'stopword',
        reason: m.text || undefined,
      })
      try {
        await sendText(m.from, 'בסדר, לא נשלח עוד הודעות. תודה!')
      } catch {/* ignore */}
      if (msgRow?.id) await sb.from('messages').update({ processed_at: new Date().toISOString() }).eq('id', msgRow.id)
      return
    }

    // 3. Audio not supported in MVP — reply once and mark processed
    if (m.type === 'audio') {
      try {
        await sendText(m.from, 'אני עוד לא יודע להאזין להודעות קוליות, אפשר לכתוב לי? 🙂')
      } catch {/* ignore */}
      if (msgRow?.id) await sb.from('messages').update({ processed_at: new Date().toISOString() }).eq('id', msgRow.id)
      return
    }

    // 4. Already-suppressed phones (shouldn't reach us but defensive)
    if (await isSuppressed(orgId, m.from)) {
      if (msgRow?.id) await sb.from('messages').update({ processed_at: new Date().toISOString() }).eq('id', msgRow.id)
      return
    }

    // ---- AI conversation path ----
    // Skip if the thread was already in human_takeover.
    if (thread.status === 'human_takeover' || thread.status === 'opted_out' || thread.status === 'admin_alerts') {
      if (msgRow?.id) await sb.from('messages').update({ processed_at: new Date().toISOString() }).eq('id', msgRow.id)
      return
    }

    // Kick off orchestrator. It atomically claims the thread, sleeps 2s
    // (coalescing any concurrent burst), runs the agent once, sends the reply.
    await processThreadIfNotLocked(thread.id)
  } catch (err) {
    console.error('[whatsapp webhook] processEvent error:', err)
  }
}

async function upsertThread(
  sb: ReturnType<typeof supabaseService>,
  orgId: string,
  phone: string,
): Promise<{ id: string; status: string }> {
  const normalized = normalizePhone(phone)
  const { data: existing } = await sb
    .from('threads')
    .select('id, status')
    .eq('org_id', orgId)
    .eq('phone', normalized)
    .maybeSingle()
  if (existing) return existing as { id: string; status: string }

  const { data: created } = await sb
    .from('threads')
    .insert({ org_id: orgId, phone: normalized, channel: 'whatsapp', status: 'active' })
    .select('id, status')
    .single()
  return created as { id: string; status: string }
}
