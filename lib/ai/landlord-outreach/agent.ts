/**
 * Landlord-outreach AI agent.
 *
 * One call per AI turn:
 *  1. Load thread context (anchor property + thread state).
 *  2. Build the user input — concatenated burst text + optional images.
 *  3. Call OpenAI Responses API. If first turn: pass `instructions` (system
 *     prompt). Subsequent turns: pass `previous_response_id` from the thread.
 *  4. Loop on tool calls up to 5 iterations.
 *  5. Persist the new response id on the thread, return the model's text.
 */

import OpenAI from 'openai'
import { supabaseService } from '../../supabase'
import { buildSystemPrompt, type LandlordContext } from './system-prompt'
import { TOOL_DEFINITIONS, executeTool, type ToolContext } from './tools'
import { humanizeReply } from '../humanize'
import type { ExtendedProperty } from '../../../types/property'

let _client: OpenAI | null = null
function client(): OpenAI {
  if (_client) return _client
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY missing')
  _client = new OpenAI({ apiKey })
  return _client
}

const MODEL = process.env.OPENAI_AGENT_MODEL || 'gpt-5.4'
const MAX_TOOL_ITERATIONS = 5

export type AgentInput = {
  threadId: string
  /** Concatenated burst text (1 or more user messages coalesced). */
  userText: string
  /** Public URLs for any images the user sent in this burst. */
  imageUrls?: string[]
}

export type AgentResult = {
  text: string
  responseId: string
  toolCalls: Array<{ name: string; arguments: unknown }>
  finishReason?: string
}

export async function runAgentTurn(input: AgentInput): Promise<AgentResult> {
  const sb = supabaseService()
  const { data: thread } = await sb
    .from('threads')
    .select('id, org_id, property_id, phone, status, openai_response_id, last_inbound_at, tags')
    .eq('id', input.threadId)
    .maybeSingle()
  if (!thread) throw new Error(`thread_not_found:${input.threadId}`)

  // Defensive guard: the landlord agent must NEVER answer a renter thread (the orchestrator routes
  // renters elsewhere, but a future routing change must not be able to make the landlord bot reply
  // to a renter). No-op instead of guessing.
  const tTags = (thread.tags && typeof thread.tags === 'object') ? thread.tags as Record<string, any> : {}
  if (tTags.audience === 'renter') {
    console.warn(`[landlord-agent] refused to run on a renter thread ${thread.id}`)
    return { text: '', responseId: thread.openai_response_id || '', toolCalls: [] }
  }

  // Anchor property (may be null if the thread isn't pinned to one yet)
  let property: ExtendedProperty | null = null
  if (thread.property_id) {
    const { data } = await sb
      .from('properties')
      .select('*')
      .eq('id', thread.property_id)
      .eq('org_id', thread.org_id)
      .maybeSingle()
    property = (data as ExtendedProperty | null) || null
  } else {
    // Fall back: pick the most recent property for this phone (last template sent to this number)
    const { data } = await sb
      .from('properties')
      .select('*')
      .eq('org_id', thread.org_id)
      .or(`contact_phone.eq.${thread.phone},contact_phone.eq.+${thread.phone}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    property = (data as ExtendedProperty | null) || null
  }

  const ctx: LandlordContext = {
    property: property as any,
    thread: {
      id: thread.id,
      status: thread.status || 'active',
      last_inbound_at: thread.last_inbound_at,
      message_count: await countThreadMessages(thread.id),
    },
  }

  const toolCtx: ToolContext = {
    orgId: thread.org_id,
    threadId: thread.id,
    propertyId: property?.id || null,
    landlordPhone: thread.phone || '',
    appBaseUrl: process.env.APP_BASE_URL,
  }

  const isFirstTurn = !thread.openai_response_id

  const userContent: Array<Record<string, unknown>> = [
    { type: 'input_text', text: input.userText },
    ...((input.imageUrls || []).map(url => ({ type: 'input_image', image_url: url }))),
  ]

  const requestBase: Record<string, unknown> = {
    model: MODEL,
    store: true,
    tools: TOOL_DEFINITIONS,
    parallel_tool_calls: false,
  }

  // Re-send the system prompt EVERY turn (not just the first). With previous_response_id
  // alone the system directives lose weight over the conversation and the agent drifts
  // (e.g. stops sending the questionnaire link). Passing instructions each turn keeps the
  // critical rules authoritative; previous_response_id still preserves conversation state.
  const systemPrompt = ctx.property ? buildSystemPrompt(ctx) : buildSystemPrompt({ ...ctx, property: PLACEHOLDER_PROPERTY })

  let response: any = await (client() as any).responses.create({
    ...requestBase,
    instructions: systemPrompt,
    ...(isFirstTurn ? {} : { previous_response_id: thread.openai_response_id }),
    input: [{ role: 'user', content: userContent }],
  })

  const allToolCalls: AgentResult['toolCalls'] = []

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const functionCalls = extractFunctionCalls(response)
    if (functionCalls.length === 0) break

    const toolOutputs: Array<{ type: 'function_call_output'; call_id: string; output: string }> = []
    for (const fc of functionCalls) {
      let args: unknown = {}
      try {
        args = fc.arguments ? JSON.parse(fc.arguments) : {}
      } catch {
        args = {}
      }
      allToolCalls.push({ name: fc.name, arguments: args })
      let out: unknown
      try {
        out = await executeTool(fc.name, args as any, toolCtx)
      } catch (err) {
        out = { error: err instanceof Error ? err.message : String(err) }
      }
      toolOutputs.push({ type: 'function_call_output', call_id: fc.call_id, output: JSON.stringify(out) })
    }

    // Re-send instructions on the tool-loop continuation too — otherwise the final reply
    // (synthesized after tool calls) drifts from the system rules (emojis, lists creep back).
    response = await (client() as any).responses.create({
      ...requestBase,
      instructions: systemPrompt,
      previous_response_id: response.id,
      input: toolOutputs,
    })
  }

  const text = humanizeReply(extractOutputText(response))
  await sb.from('threads').update({ openai_response_id: response.id }).eq('id', input.threadId)

  return {
    text,
    responseId: response.id,
    toolCalls: allToolCalls,
    finishReason: response.status || response.finish_reason,
  }
}

async function countThreadMessages(threadId: string): Promise<number> {
  const sb = supabaseService()
  const { count } = await sb
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('thread_id', threadId)
  return count || 0
}

function extractFunctionCalls(response: any): Array<{ name: string; arguments: string; call_id: string }> {
  const calls: Array<{ name: string; arguments: string; call_id: string }> = []
  const output = response?.output
  if (Array.isArray(output)) {
    for (const item of output) {
      if (item?.type === 'function_call') {
        calls.push({
          name: item.name,
          arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {}),
          call_id: item.call_id,
        })
      }
    }
  }
  return calls
}

function extractOutputText(response: any): string {
  // Read the LAST assistant message (the final reply), de-duping identical content blocks. Do NOT
  // trust `response.output_text`: that SDK getter concatenates ALL message parts, and the model
  // occasionally emits its reply twice — which would glue into a doubled message.
  const output = response?.output
  if (Array.isArray(output)) {
    const messages = output.filter((it: any) => it?.type === 'message' && Array.isArray(it.content))
    const last = messages[messages.length - 1]
    if (last) {
      const seen = new Set<string>()
      const textParts: string[] = []
      for (const c of last.content) {
        if (c?.type === 'output_text' && typeof c.text === 'string' && c.text && !seen.has(c.text)) {
          seen.add(c.text); textParts.push(c.text)
        }
      }
      if (textParts.length) return textParts.join('\n')
    }
  }
  if (typeof response?.output_text === 'string' && response.output_text) return response.output_text
  return ''
}

// Used when the agent runs without a property context (rare — usually an admin alert thread).
const PLACEHOLDER_PROPERTY: LandlordContext['property'] = {
  id: '',
  title: '',
  city: '',
  neighborhood: null,
  address: null,
  street: null,
  price: 0,
  rooms: null,
  sqm: null,
  floor: null,
  amenities: null,
  contact_name: null,
  evacuation_date: null,
  description: null,
}
