/**
 * Tools the WhatsApp landlord-outreach agent can call.
 *
 * The tool definitions follow the OpenAI Responses API shape:
 *   { type: 'function', name, description, parameters: { ... JSON Schema ... } }
 *
 * Each tool is paired with an executor that runs server-side, hits Supabase
 * with the service role, and returns a JSON-serializable result that flows
 * back into the model on the next iteration.
 */

import { supabaseService } from '../../supabase'
import { embedText } from '../embeddings'
import { sendImage } from '../../whatsapp/meta-provider'
import { recordOptOut } from '../../outreach/suppression'
import { isInSessionWindow } from '../../whatsapp/window-guard'
import { notifyAdminsHandoff } from '../../alerts/admin-whatsapp'

export type ToolContext = {
  orgId: string
  threadId: string
  propertyId: string | null
  landlordPhone: string
  /** Absolute base URL for building admin-alert deep links. Falls back to APP_BASE_URL env. */
  appBaseUrl?: string | undefined
}

export type ToolDefinition = {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    name: 'get_property_summary',
    description: 'Return structured details about a property. Defaults to the thread anchor property.',
    parameters: {
      type: 'object',
      properties: {
        property_id: { type: 'string', description: 'Optional UUID; omit to use the anchor property.' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_property_photos',
    description: 'Return image URLs for a property so you can decide whether to attach one to your reply.',
    parameters: {
      type: 'object',
      properties: {
        property_id: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'attach_image_to_response',
    description: 'Send a property image to the landlord as a separate WhatsApp message in the current session. Use sparingly — only when an image meaningfully advances the conversation.',
    parameters: {
      type: 'object',
      properties: {
        image_url: { type: 'string' },
        caption: { type: 'string' },
      },
      required: ['image_url'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'search_property_context',
    description: 'Semantic search over property records. Use this whenever you need a specific fact about the landlord property (description text, amenities, history). Returns top-k matching properties with their key fields.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        property_id: { type: 'string', description: 'Restrict to a single property if provided.' },
        k: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'search_past_conversations',
    description: 'Semantic search over earlier messages in this thread (or all threads for this phone). Use when the landlord references something from earlier and you need the exact quote.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        scope: { type: 'string', enum: ['thread', 'phone'] },
        k: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'record_landlord_intent',
    description: 'Mark the conversation outcome. Call this once per turn when the landlord state is clear.',
    parameters: {
      type: 'object',
      properties: {
        intent: { type: 'string', enum: ['interested', 'not_interested', 'already_rented', 'callback_later', 'price_objection'] },
        notes: { type: 'string' },
      },
      required: ['intent'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'update_property_field',
    description: 'Update a property field with information the landlord shared. Whitelist only.',
    parameters: {
      type: 'object',
      properties: {
        field: { type: 'string', enum: ['contact_name', 'evacuation_date', 'pets_allowed', 'smokers_allowed', 'price', 'description'] },
        value: { description: 'string for text/date/description; number for price; boolean for pets_allowed and smokers_allowed.' },
      },
      required: ['field', 'value'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_matching_renters_for_property',
    description: 'Return the count of currently-active renters in our pool that match this property (non-disqualified) plus a few aggregate stats. USE THIS whenever the landlord asks "how many renters do you have" / "are there renters for my apartment" — answer with the real number, never invent.',
    parameters: {
      type: 'object',
      properties: {
        property_id: { type: 'string', description: 'Defaults to the anchor property if omitted.' },
        min_score: { type: 'integer', minimum: 0, maximum: 100, description: 'Only count matches at or above this score (default 60).' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'handoff_to_human',
    description: 'Hand the conversation off to the admin. Dispatches an admin WhatsApp alert and flips the thread to human_takeover. Use when the landlord asks for a human OR when you decide an admin should close.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
        urgency: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'opt_out_landlord',
    description: 'Honor an explicit opt-out from the landlord (e.g., they ask not to be contacted further). Use sparingly — the webhook already handles hard stop-words. This is for contextual refusals the regex missed.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
      },
      required: [],
      additionalProperties: false,
    },
  },
]

// ---------- Executors ------------------------------------------------------

export async function executeTool(name: string, args: any, ctx: ToolContext): Promise<unknown> {
  switch (name) {
    case 'get_property_summary': return getPropertySummary(args, ctx)
    case 'get_property_photos': return getPropertyPhotos(args, ctx)
    case 'attach_image_to_response': return attachImage(args, ctx)
    case 'search_property_context': return searchPropertyContext(args, ctx)
    case 'search_past_conversations': return searchPastConversations(args, ctx)
    case 'record_landlord_intent': return recordIntent(args, ctx)
    case 'update_property_field': return updatePropertyField(args, ctx)
    case 'get_matching_renters_for_property': return getMatchingRenters(args, ctx)
    case 'handoff_to_human': return handoff(args, ctx)
    case 'opt_out_landlord': return optOut(args, ctx)
    default:
      return { error: `unknown_tool:${name}` }
  }
}

async function getPropertySummary(args: { property_id?: string }, ctx: ToolContext) {
  const sb = supabaseService()
  const id = args.property_id || ctx.propertyId
  if (!id) return { error: 'no_property_id' }
  const { data, error } = await sb
    .from('properties')
    .select('id, title, city, neighborhood, address, street, price, rooms, sqm, floor, amenities, contact_name, contact_phone, evacuation_date, description, full_text, is_active, outreach_blocked, source')
    .eq('id', id)
    .eq('org_id', ctx.orgId)
    .maybeSingle()
  if (error || !data) return { error: 'property_not_found' }
  return data
}

async function getPropertyPhotos(args: { property_id?: string; limit?: number }, ctx: ToolContext) {
  const sb = supabaseService()
  const id = args.property_id || ctx.propertyId
  if (!id) return { error: 'no_property_id' }
  const { data } = await sb
    .from('properties')
    .select('images')
    .eq('id', id)
    .eq('org_id', ctx.orgId)
    .maybeSingle()
  const all: string[] = Array.isArray(data?.images) ? (data!.images as string[]) : []
  const limit = Math.max(1, Math.min(args.limit ?? 5, 10))
  return { property_id: id, images: all.slice(0, limit), total: all.length }
}

async function attachImage(args: { image_url: string; caption?: string }, ctx: ToolContext) {
  if (!args.image_url) return { error: 'image_url_missing' }
  try {
    const r = await sendImage({ to: ctx.landlordPhone, link: args.image_url, caption: args.caption })
    return { ok: true, message_id: r.messageId }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function searchPropertyContext(args: { query: string; property_id?: string; k?: number }, ctx: ToolContext) {
  const sb = supabaseService()
  const k = Math.max(1, Math.min(args.k ?? 5, 10))
  const vec = await embedText(args.query)
  // pgvector cosine distance operator <=>. Use RPC for typed call.
  const { data, error } = await sb.rpc('match_properties', {
    query_embedding: vec as any,
    match_org_id: ctx.orgId,
    match_property_id: args.property_id || null,
    match_count: k,
  })
  if (error) {
    // Fallback: raw select using cosine ordering (slower without index hint)
    const { data: rows } = await sb
      .from('properties')
      .select('id, title, city, neighborhood, address, price, rooms, sqm, description, full_text')
      .eq('org_id', ctx.orgId)
      .not('embedding', 'is', null)
      .limit(k)
    return { results: rows || [], note: 'rpc_unavailable_fallback' }
  }
  return { results: data || [] }
}

async function searchPastConversations(args: { query: string; scope?: 'thread' | 'phone'; k?: number }, ctx: ToolContext) {
  const sb = supabaseService()
  const k = Math.max(1, Math.min(args.k ?? 5, 10))
  const scope = args.scope || 'thread'
  const vec = await embedText(args.query)
  const { data, error } = await sb.rpc('match_messages', {
    query_embedding: vec as any,
    match_org_id: ctx.orgId,
    match_thread_id: scope === 'thread' ? ctx.threadId : null,
    match_phone: scope === 'phone' ? ctx.landlordPhone : null,
    match_count: k,
  })
  if (error) {
    const { data: rows } = await sb
      .from('messages')
      .select('id, thread_id, direction, body, created_at')
      .eq('org_id', ctx.orgId)
      .eq('thread_id', ctx.threadId)
      .not('embedding', 'is', null)
      .order('created_at', { ascending: false })
      .limit(k)
    return { results: rows || [], note: 'rpc_unavailable_fallback' }
  }
  return { results: data || [] }
}

async function recordIntent(args: { intent: string; notes?: string }, ctx: ToolContext) {
  const sb = supabaseService()
  const { data: thread } = await sb.from('threads').select('tags').eq('id', ctx.threadId).maybeSingle()
  const tags = (thread?.tags && typeof thread.tags === 'object' ? thread.tags : {}) as Record<string, unknown>
  tags.intent = args.intent
  if (args.notes) tags.intent_notes = args.notes
  tags.intent_set_at = new Date().toISOString()
  await sb.from('threads').update({ tags }).eq('id', ctx.threadId)
  return { ok: true, intent: args.intent }
}

async function updatePropertyField(args: { field: string; value: unknown }, ctx: ToolContext) {
  const allowed = new Set(['contact_name', 'evacuation_date', 'pets_allowed', 'smokers_allowed', 'price', 'description'])
  if (!allowed.has(args.field)) return { error: 'field_not_allowed' }
  if (!ctx.propertyId) return { error: 'no_property_id' }
  const sb = supabaseService()
  const update: Record<string, unknown> = { [args.field]: args.value }
  const { error } = await sb.from('properties').update(update).eq('id', ctx.propertyId).eq('org_id', ctx.orgId)
  if (error) return { ok: false, error: error.message }
  return { ok: true, field: args.field }
}

async function getMatchingRenters(args: { property_id?: string; min_score?: number }, ctx: ToolContext) {
  const sb = supabaseService()
  const id = args.property_id || ctx.propertyId
  if (!id) return { error: 'no_property_id' }
  const minScore = typeof args.min_score === 'number' ? args.min_score : 60

  const { data: matches } = await sb
    .from('matches')
    .select('id, score, is_disqualified, reasons')
    .eq('org_id', ctx.orgId)
    .eq('property_id', id)
    .eq('is_disqualified', false)
    .gte('score', minScore)
    .order('score', { ascending: false })

  const rows = matches || []
  const scores = rows.map(r => Number(r.score) || 0).filter(s => s > 0)
  const top = scores.length ? Math.max(...scores) : null
  const avg = scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : null

  return {
    property_id: id,
    min_score: minScore,
    count: rows.length,
    top_score: top,
    avg_score: avg,
    examples: rows.slice(0, 3).map(r => ({ score: Number(r.score) || 0, highlights: r.reasons || [] })),
  }
}

async function handoff(args: { reason: string; urgency?: 'low' | 'medium' | 'high' }, ctx: ToolContext) {
  const sb = supabaseService()
  await sb.from('threads').update({ status: 'human_takeover' }).eq('id', ctx.threadId)
  await sb.from('conversation_alerts').insert({
    org_id: ctx.orgId,
    thread_id: ctx.threadId,
    type: 'handoff',
    payload: { reason: args.reason, urgency: args.urgency || 'low' },
  })

  // Pull landlord + property context for the alert template
  const { data: thread } = await sb.from('threads').select('phone').eq('id', ctx.threadId).maybeSingle()
  const phone = thread?.phone || ctx.landlordPhone
  let landlordName = 'לקוח'
  let propertyTitle = ''
  if (ctx.propertyId) {
    const { data: p } = await sb
      .from('properties')
      .select('title, contact_name, city, street, address')
      .eq('id', ctx.propertyId)
      .maybeSingle()
    if (p) {
      landlordName = p.contact_name || landlordName
      propertyTitle = p.title || [p.street || p.address, p.city].filter(Boolean).join(', ') || ''
    }
  }
  const base = ctx.appBaseUrl || process.env.APP_BASE_URL || 'https://rent360.vercel.app'
  await notifyAdminsHandoff({
    threadId: ctx.threadId,
    landlordName,
    landlordPhone: phone,
    propertyTitle,
    reason: args.reason,
    dashboardUrl: `${base.replace(/\/$/, '')}/inbox/${ctx.threadId}`,
  })

  return { ok: true, status: 'human_takeover' }
}

async function optOut(args: { reason?: string }, ctx: ToolContext) {
  await recordOptOut({
    orgId: ctx.orgId,
    phone: ctx.landlordPhone,
    reason: args.reason,
    source: 'ai_tool',
  })
  // Within the 24h window the orchestrator will send an ack via sendText.
  return { ok: true, status: 'opted_out' }
}

// ---------- pgvector RPC helpers (create-if-missing) -----------------------

/**
 * SQL to create the RPC helpers. Run once via Supabase MCP:
 *
 *   create or replace function match_properties(...)
 *
 * (Implementation lives in the migration; this comment is a pointer.)
 */
export const RPC_NOTE = 'See supabase/migrations/0006_vector_rpcs.sql for match_properties / match_messages.'
