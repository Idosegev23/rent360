/**
 * Renter REPLY agent. One call per turn: load the share-safe context for the matched property
 * (via the thread's renter_id tag + property anchor), build the reply system prompt, call the
 * OpenAI Responses API with the reply tools, loop tool calls, persist the response id.
 *
 * Mirrors `renter-interview/agent.ts`. Answers questions about the matched apartment; never the
 * street address. If context can't be resolved, it hands the thread to a human rather than guessing.
 */

import OpenAI from 'openai'
import { supabaseService } from '../../supabase'
import { buildReplySystemPrompt } from './system-prompt'
import { loadReplyContext } from './property-context'
import { REPLY_TOOL_DEFINITIONS, executeReplyTool, type ReplyToolContext } from './tools'
import { notifyAdminsHandoff } from '../../alerts/admin-whatsapp'
import { humanizeReply } from '../humanize'

let _client: OpenAI | null = null
function client(): OpenAI {
  if (_client) return _client
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY missing')
  _client = new OpenAI({ apiKey })
  return _client
}

const MODEL = process.env.OPENAI_AGENT_MODEL || 'gpt-5.4'
const MAX_TOOL_ITERATIONS = 6

export type ReplyAgentInput = { threadId: string; userText: string; imageUrls?: string[] }
export type ReplyAgentResult = { text: string; responseId: string; toolCalls: Array<{ name: string; arguments: unknown }>; finishReason?: string }

export async function runRenterReplyTurn(input: ReplyAgentInput): Promise<ReplyAgentResult> {
  const sb = supabaseService()
  const { data: thread } = await sb
    .from('threads')
    .select('id, org_id, phone, status, openai_response_id, tags, property_id')
    .eq('id', input.threadId)
    .maybeSingle()
  if (!thread) throw new Error(`thread_not_found:${input.threadId}`)

  const ctx = await loadReplyContext(thread.org_id, thread.id)
  if (!ctx) {
    // Couldn't resolve renter + matched property — never guess. Hand to a human and reply softly.
    await sb.from('threads').update({ status: 'human_takeover' }).eq('id', thread.id)
    try {
      await notifyAdminsHandoff({
        threadId: thread.id,
        landlordName: 'שוכר',
        landlordPhone: thread.phone || '',
        propertyTitle: 'דירה',
        reason: 'reply-bot: לא הצליח לזהות שוכר/נכס',
        dashboardUrl: `${(process.env.APP_BASE_URL || 'https://rent360-vert.vercel.app').replace(/\/$/, '')}/inbox/${thread.id}`,
      })
    } catch {/* best-effort */}
    return { text: 'תודה על ההודעה, אחזור אליך בהקדם.', responseId: thread.openai_response_id || '', toolCalls: [] }
  }

  const propertyLabel = [ctx.property.city, ctx.property.neighborhood].filter(Boolean).join(' · ') || 'דירה'
  const toolCtx: ReplyToolContext = {
    orgId: thread.org_id,
    threadId: thread.id,
    renterId: ctx.renterId,
    propertyId: ctx.propertyId,
    matchId: ctx.matchId,
    phone: thread.phone || '',
    shareUrl: ctx.shareUrl,
    propertyLabel,
    appBaseUrl: process.env.APP_BASE_URL,
  }

  const isFirstTurn = !thread.openai_response_id
  const userContent: Array<Record<string, unknown>> = [
    { type: 'input_text', text: input.userText },
    ...((input.imageUrls || []).map(url => ({ type: 'input_image', image_url: url }))),
  ]
  const requestBase: Record<string, unknown> = { model: MODEL, store: true, tools: REPLY_TOOL_DEFINITIONS, parallel_tool_calls: false }
  const systemPrompt = buildReplySystemPrompt(ctx)

  let response: any = await (client() as any).responses.create({
    ...requestBase,
    instructions: systemPrompt,
    ...(isFirstTurn ? {} : { previous_response_id: thread.openai_response_id }),
    input: [{ role: 'user', content: userContent }],
  })

  const allToolCalls: ReplyAgentResult['toolCalls'] = []
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const functionCalls = extractFunctionCalls(response)
    if (functionCalls.length === 0) break
    const toolOutputs: Array<{ type: 'function_call_output'; call_id: string; output: string }> = []
    for (const fc of functionCalls) {
      let args: unknown = {}
      try { args = fc.arguments ? JSON.parse(fc.arguments) : {} } catch { args = {} }
      allToolCalls.push({ name: fc.name, arguments: args })
      let out: unknown
      try { out = await executeReplyTool(fc.name, args as any, toolCtx) } catch (err) { out = { error: err instanceof Error ? err.message : String(err) } }
      toolOutputs.push({ type: 'function_call_output', call_id: fc.call_id, output: JSON.stringify(out) })
    }
    response = await (client() as any).responses.create({
      ...requestBase,
      instructions: systemPrompt,
      previous_response_id: response.id,
      input: toolOutputs,
    })
  }

  const text = humanizeReply(extractOutputText(response))
  await sb.from('threads').update({ openai_response_id: response.id }).eq('id', input.threadId)
  return { text, responseId: response.id, toolCalls: allToolCalls, finishReason: response.status }
}

function extractFunctionCalls(response: any): Array<{ name: string; arguments: string; call_id: string }> {
  const calls: Array<{ name: string; arguments: string; call_id: string }> = []
  const output = response?.output
  if (Array.isArray(output)) for (const item of output) if (item?.type === 'function_call') calls.push({ name: item.name, arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {}), call_id: item.call_id })
  return calls
}

function extractOutputText(response: any): string {
  if (typeof response?.output_text === 'string' && response.output_text) return response.output_text
  const output = response?.output
  if (Array.isArray(output)) {
    const parts: string[] = []
    for (const item of output) if (item?.type === 'message' && Array.isArray(item.content)) for (const c of item.content) if (c?.type === 'output_text' && typeof c.text === 'string') parts.push(c.text)
    if (parts.length) return parts.join('\n')
  }
  return ''
}
