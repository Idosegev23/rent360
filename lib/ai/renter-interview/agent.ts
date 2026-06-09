/**
 * Renter-intake AI agent. One call per turn: load the renter (via the thread's renter_id
 * tag), build the intake system prompt, call the OpenAI Responses API with the intake tools,
 * loop tool calls, persist the response id. Mirrors the landlord agent.
 */

import OpenAI from 'openai'
import { supabaseService } from '../../supabase'
import { buildRenterSystemPrompt, type RenterContext } from './system-prompt'
import { RENTER_TOOL_DEFINITIONS, executeRenterTool, type RenterToolContext } from './tools'
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

export type RenterAgentInput = { threadId: string; userText: string; imageUrls?: string[] }
export type RenterAgentResult = { text: string; responseId: string; toolCalls: Array<{ name: string; arguments: unknown }>; finishReason?: string }

const RENTER_COLS = 'id, first_name, last_name, preferred_cities, preferred_neighborhoods, budget_min, budget_max, preferred_rooms, rooms_flexible, min_sqm, floor_min, floor_max, move_in_date, contract_length, household_type, household_size, has_children, children_count, has_pets, smokers, employment_status, has_payslips, has_security_checks, has_guarantors, preferences, notes'

export async function runRenterAgentTurn(input: RenterAgentInput): Promise<RenterAgentResult> {
  const sb = supabaseService()
  const { data: thread } = await sb
    .from('threads')
    .select('id, org_id, phone, status, openai_response_id, tags')
    .eq('id', input.threadId)
    .maybeSingle()
  if (!thread) throw new Error(`thread_not_found:${input.threadId}`)

  const tags = (thread.tags && typeof thread.tags === 'object') ? thread.tags as Record<string, any> : {}
  let renterId: string | null = tags.renter_id || null
  // Fallback: resolve the renter by phone if the thread isn't tagged.
  if (!renterId && thread.phone) {
    const { data: r } = await sb.from('renters').select('id').eq('phone', thread.phone).maybeSingle()
    renterId = r?.id || null
  }
  if (!renterId) throw new Error('renter_not_resolved')

  const { data: renter } = await sb.from('renters').select(RENTER_COLS).eq('id', renterId).maybeSingle()
  if (!renter) throw new Error('renter_not_found')

  const ctx: RenterContext = {
    renter: renter as any,
    thread: { id: thread.id, status: thread.status || 'active', message_count: await countThreadMessages(thread.id) },
  }
  const toolCtx: RenterToolContext = {
    orgId: thread.org_id,
    threadId: thread.id,
    renterId,
    phone: thread.phone || '',
    appBaseUrl: process.env.APP_BASE_URL,
  }

  const isFirstTurn = !thread.openai_response_id
  const userContent: Array<Record<string, unknown>> = [
    { type: 'input_text', text: input.userText },
    ...((input.imageUrls || []).map(url => ({ type: 'input_image', image_url: url }))),
  ]
  const requestBase: Record<string, unknown> = { model: MODEL, store: true, tools: RENTER_TOOL_DEFINITIONS, parallel_tool_calls: false }
  const systemPrompt = buildRenterSystemPrompt(ctx)

  let response: any = await (client() as any).responses.create({
    ...requestBase,
    instructions: systemPrompt,
    ...(isFirstTurn ? {} : { previous_response_id: thread.openai_response_id }),
    input: [{ role: 'user', content: userContent }],
  })

  const allToolCalls: RenterAgentResult['toolCalls'] = []
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const functionCalls = extractFunctionCalls(response)
    if (functionCalls.length === 0) break
    const toolOutputs: Array<{ type: 'function_call_output'; call_id: string; output: string }> = []
    for (const fc of functionCalls) {
      let args: unknown = {}
      try { args = fc.arguments ? JSON.parse(fc.arguments) : {} } catch { args = {} }
      allToolCalls.push({ name: fc.name, arguments: args })
      let out: unknown
      try { out = await executeRenterTool(fc.name, args as any, toolCtx) } catch (err) { out = { error: err instanceof Error ? err.message : String(err) } }
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

async function countThreadMessages(threadId: string): Promise<number> {
  const sb = supabaseService()
  const { count } = await sb.from('messages').select('id', { count: 'exact', head: true }).eq('thread_id', threadId)
  return count || 0
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
