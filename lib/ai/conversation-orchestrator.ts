/**
 * Conversation orchestrator: atomic per-thread claim + 2s coalesce window.
 *
 * Why: WhatsApp users type in bursts ("היי" → "תזכיר לי" → "כמה זה עולה?"
 * within 1.5s). Without protection, each lands in a parallel Vercel
 * serverless invocation and we'd fire 3 simultaneous OpenAI calls with stale
 * previous_response_id, producing duplicate / conflicting replies.
 *
 * Why not pg_advisory_lock: Supabase ships with pgbouncer in transaction
 * pool mode by default. An advisory lock acquired in one statement is lost
 * the moment the connection returns to the pool — we can't hold it across
 * a 2s Node-side sleep. Instead we use `threads.processing_started_at` as
 * an atomic claim flag and `UPDATE ... WHERE processing_started_at IS NULL
 * OR processing_started_at < now() - interval '30 seconds' RETURNING id`.
 * Only the worker that wins the update sleeps + processes. Stale claims
 * older than 30s are auto-recoverable (a crashed worker doesn't deadlock
 * the thread forever).
 */

import { supabaseService } from '../supabase'
import { sendText } from '../whatsapp/meta-provider'
import { isInSessionWindow } from '../whatsapp/window-guard'
import { runAgentTurn } from './landlord-outreach/agent'
import { runRenterAgentTurn } from './renter-interview/agent'
import { embedInBackground, embedMessage } from './embeddings'

const COALESCE_MS = parseInt(process.env.WEBHOOK_COALESCE_MS || '2000', 10)
const STALE_CLAIM_MS = 30_000

export type OrchestratorResult = {
  status: 'processed' | 'skipped_locked' | 'skipped_no_messages' | 'window_closed' | 'human_takeover'
  text?: string
  responseId?: string
  toolCallCount?: number
  burstSize?: number
}

export async function processThreadIfNotLocked(threadId: string): Promise<OrchestratorResult> {
  const sb = supabaseService()

  // Atomic claim: only succeeds if no claim exists OR the existing claim is stale.
  const staleCutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString()
  const claimedAt = new Date().toISOString()
  const { data: claimedRows, error: claimErr } = await sb
    .from('threads')
    .update({ processing_started_at: claimedAt })
    .eq('id', threadId)
    .or(`processing_started_at.is.null,processing_started_at.lt.${staleCutoff}`)
    .select('id')

  if (claimErr) {
    // Best-effort: if the claim can't be performed (e.g. PostgREST schema-cache lag right
    // after the processing_started_at migration), PROCEED without the lock rather than
    // dropping the reply entirely. Worst case is a possible duplicate during a burst; that
    // is far better than the agent never replying. Self-heals once the cache refreshes.
    console.error('[orchestrator] claim error (proceeding without lock):', claimErr.message)
  } else if (!claimedRows || claimedRows.length === 0) {
    // Another worker holds the claim.
    return { status: 'skipped_locked' }
  }

  try {
    await sleep(COALESCE_MS)

    const { data: thread } = await sb
      .from('threads')
      .select('id, org_id, phone, status, last_inbound_at, tags')
      .eq('id', threadId)
      .maybeSingle()
    if (!thread) return { status: 'skipped_no_messages' }
    if (thread.status === 'human_takeover' || thread.status === 'opted_out') {
      return { status: 'human_takeover' }
    }

    const { data: pending } = await sb
      .from('messages')
      .select('id, body, media_url, meta_message_type, created_at')
      .eq('thread_id', threadId)
      .eq('direction', 'in')
      .is('processed_at', null)
      .order('created_at', { ascending: true })

    if (!pending || pending.length === 0) {
      return { status: 'skipped_no_messages' }
    }

    const textParts: string[] = []
    const imageUrls: string[] = []
    for (const m of pending) {
      if (m.body && m.body.trim()) textParts.push(m.body.trim())
      if (m.media_url) imageUrls.push(m.media_url)
    }
    const userText = textParts.join('\n') || `[user sent ${pending[0]?.meta_message_type || 'message'}]`

    if (!isInSessionWindow(thread.last_inbound_at)) {
      // Mark consumed so we don't keep retrying; the bot can't reply outside the window.
      await sb.from('messages').update({ processed_at: new Date().toISOString() }).in('id', pending.map(p => p.id))
      return { status: 'window_closed' }
    }

    // Route by audience: a renter thread gets the intake bot, otherwise the landlord bot.
    const tags = (thread.tags && typeof thread.tags === 'object') ? thread.tags as Record<string, any> : {}
    const isRenter = tags.audience === 'renter'
    const turn = isRenter
      ? await runRenterAgentTurn({ threadId, userText, imageUrls })
      : await runAgentTurn({ threadId, userText, imageUrls })

    if (turn.text && turn.text.trim()) {
      try {
        const sent = await sendText(thread.phone || '', turn.text.trim())
        const { data: outRow } = await sb.from('messages').insert({
          org_id: thread.org_id,
          thread_id: thread.id,
          channel: 'whatsapp',
          direction: 'out',
          body: turn.text.trim(),
          status: 'sent',
          external_id: sent.messageId,
          meta_message_type: 'text',
          ai_metadata: {
            model: process.env.OPENAI_AGENT_MODEL || 'gpt-5.4',
            response_id: turn.responseId,
            tool_calls: turn.toolCalls,
            input_text: userText,
            input_image_count: imageUrls.length,
          },
        }).select('id').single()
        await sb.from('threads').update({
          last_outbound_at: new Date().toISOString(),
          last_message_at: new Date().toISOString(),
        }).eq('id', thread.id)
        if (outRow?.id) embedInBackground(() => embedMessage(outRow.id), `out:${outRow.id}`)
      } catch (err) {
        console.error('[orchestrator] sendText failed:', err)
      }
    }

    await sb.from('messages').update({ processed_at: new Date().toISOString() }).in('id', pending.map(p => p.id))

    return {
      status: 'processed',
      text: turn.text,
      responseId: turn.responseId,
      toolCallCount: turn.toolCalls.length,
      burstSize: pending.length,
    }
  } finally {
    // Clear the claim so the next burst can be picked up.
    try {
      await sb.from('threads').update({ processing_started_at: null }).eq('id', threadId)
    } catch {/* ignore */}
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
