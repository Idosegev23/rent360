/**
 * Embeddings — text-embedding-3-small (1536 dims) via the OpenAI SDK.
 *
 * Two consumers:
 *  - Properties: embed full_text + structured fields. Re-embed only when
 *    the concatenated source text changes (tracked via sha256 hash).
 *  - Messages: embed the body of every inbound and outbound text message
 *    so the bot can `search_past_conversations` semantically.
 *
 * All inserts are fire-and-forget from the caller's perspective (don't
 * block message handling on embedding latency).
 */

import crypto from 'crypto'
import OpenAI from 'openai'
import { supabaseService } from '../supabase'

const EMBED_MODEL = 'text-embedding-3-small'

let _client: OpenAI | null = null
function client(): OpenAI {
  if (_client) return _client
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY missing')
  _client = new OpenAI({ apiKey })
  return _client
}

/** Hard cap on input length — `text-embedding-3-small` accepts 8191 tokens. We crudely cap at ~24000 chars (~6k tokens) to leave headroom. */
function trim(text: string, maxChars = 24000): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars)
}

export async function embedText(text: string): Promise<number[]> {
  const trimmed = trim(text)
  if (!trimmed.trim()) throw new Error('embedText: empty input')
  const res = await client().embeddings.create({
    model: EMBED_MODEL,
    input: trimmed,
  })
  const vec = res.data[0]?.embedding
  if (!vec) throw new Error('embedText: no embedding returned')
  return vec
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex')
}

function buildPropertySourceText(p: any): string {
  const amenitiesText = p.amenities
    ? Object.entries(p.amenities)
        .filter(([_, v]) => v === true)
        .map(([k]) => k)
        .join(', ')
    : ''
  return [
    p.title || '',
    p.address || '',
    p.neighborhood || '',
    p.city || '',
    p.description || '',
    p.full_text || '',
    amenitiesText ? `amenities: ${amenitiesText}` : '',
  ].filter(Boolean).join('\n')
}

/** Embed a property only if its source text changed since last embed. Idempotent + cheap. */
export async function embedPropertyIfChanged(propertyId: string): Promise<{ embedded: boolean; skipped: boolean }> {
  const sb = supabaseService()
  const { data: p } = await sb
    .from('properties')
    .select('id, title, address, neighborhood, city, description, full_text, amenities, embedding_source_hash')
    .eq('id', propertyId)
    .maybeSingle()
  if (!p) return { embedded: false, skipped: true }

  const source = buildPropertySourceText(p)
  if (!source.trim()) return { embedded: false, skipped: true }

  const hash = sha256(source)
  if (p.embedding_source_hash === hash) return { embedded: false, skipped: true }

  const vec = await embedText(source)
  await sb
    .from('properties')
    .update({ embedding: vec as any, embedding_source_hash: hash })
    .eq('id', propertyId)
  return { embedded: true, skipped: false }
}

function buildRenterSourceText(r: any): string {
  // We mostly care about the freeform notes, but the structured fields give
  // the embedding a bit of grounding ("she said she's a single self-employed
  // pet-owner looking near the beach" reads better than "near the beach" on
  // its own). Keep it short — semantic match is for nuance, the structured
  // dimensions already cover the hard constraints.
  const cities = Array.isArray(r.preferred_cities) ? r.preferred_cities.join(', ') : ''
  const nbhs   = Array.isArray(r.preferred_neighborhoods) ? r.preferred_neighborhoods.join(', ') : ''
  return [
    r.notes || '',
    cities ? `preferred cities: ${cities}` : '',
    nbhs ? `preferred neighborhoods: ${nbhs}` : '',
    r.household_type ? `household type: ${r.household_type}` : '',
    r.employment_status ? `employment: ${r.employment_status}` : '',
  ].filter(Boolean).join('\n')
}

/** Embed a renter's notes only when the source text changed. Same shape as
 *  embedPropertyIfChanged so callers don't need to think about which one is
 *  which. Skips silently when the renter has no notes worth embedding. */
export async function embedRenterIfChanged(renterId: string): Promise<{ embedded: boolean; skipped: boolean }> {
  const sb = supabaseService()
  const { data: r } = await sb
    .from('renters')
    .select('id, notes, preferred_cities, preferred_neighborhoods, household_type, employment_status, notes_embedding_hash')
    .eq('id', renterId)
    .maybeSingle()
  if (!r) return { embedded: false, skipped: true }

  const source = buildRenterSourceText(r)
  // Tiny inputs are noise — a single-word note ("שקט") doesn't tell us much
  // semantically and the matcher should treat the dimension as "didn't ask".
  if (source.trim().length < 10) return { embedded: false, skipped: true }

  const hash = sha256(source)
  if (r.notes_embedding_hash === hash) return { embedded: false, skipped: true }

  const vec = await embedText(source)
  await sb
    .from('renters')
    .update({ notes_embedding: vec as any, notes_embedding_hash: hash })
    .eq('id', renterId)
  return { embedded: true, skipped: false }
}

export async function embedMessage(messageId: string): Promise<{ embedded: boolean; skipped: boolean }> {
  const sb = supabaseService()
  const { data: m } = await sb
    .from('messages')
    .select('id, body, embedding')
    .eq('id', messageId)
    .maybeSingle()
  if (!m || !m.body) return { embedded: false, skipped: true }
  if (m.embedding) return { embedded: false, skipped: true }
  const vec = await embedText(m.body)
  await sb.from('messages').update({ embedding: vec as any }).eq('id', messageId)
  return { embedded: true, skipped: false }
}

/** Fire-and-forget wrapper for hot paths. Logs to console on failure but never throws. */
export function embedInBackground(fn: () => Promise<unknown>, label: string): void {
  fn().catch(err => {
    console.error(`[embed:${label}] ${err instanceof Error ? err.message : String(err)}`)
  })
}
