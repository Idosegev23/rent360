/**
 * Builds the share-safe context the renter reply-bot answers from.
 *
 * HARD RULE: this loader must NEVER read the property's `street` / house number. The model only
 * ever sees city + neighborhood (same guarantee as the public /share page). The exact address is
 * revealed by a human only when a viewing is arranged.
 */

import { supabaseService } from '../../supabase'
import { processPropertyForSharing } from '../../ai-property-processor'

export type ReplyContext = {
  renterId: string
  propertyId: string
  matchId: string | null
  shareUrl: string | null
  renter: { firstName: string | null; budgetMax: number | null; preferredRooms: number | null; moveInDate: string | null }
  property: {
    title: string | null
    city: string | null
    neighborhood: string | null
    price: number | null
    rooms: number | null
    sqm: number | null
    floor: number | null
    type: string | null
    condition: string | null
    petsAllowed: boolean | null
    smokersAllowed: boolean | null
    longTerm: boolean | null
    availableFrom: string | null
    amenities: Record<string, unknown> | null
    aiDescription: string | null
    aiHighlights: string[] | null
  }
  match: { percentage: number; matches: string[]; missing: string[] } | null
}

// Safe columns only — `street` is deliberately absent.
const SAFE_PROPERTY_COLS =
  'id, title, city, neighborhood, price, rooms, sqm, floor, type, condition, pets_allowed, smokers_allowed, long_term, available_from, amenities, description'

export async function loadReplyContext(orgId: string, threadId: string): Promise<ReplyContext | null> {
  const sb = supabaseService()

  const { data: thread } = await sb
    .from('threads')
    .select('id, property_id, phone, tags')
    .eq('id', threadId)
    .maybeSingle()
  if (!thread) return null

  const tags = (thread.tags && typeof thread.tags === 'object') ? thread.tags as Record<string, any> : {}
  let renterId: string | null = tags.renter_id || null
  if (!renterId && thread.phone) {
    const { data: r } = await sb.from('renters').select('id').eq('phone', thread.phone).maybeSingle()
    renterId = r?.id || null
  }
  const propertyId: string | null = thread.property_id || null
  if (!renterId || !propertyId) return null

  const { data: renter } = await sb
    .from('renters')
    .select('first_name, budget_max, preferred_rooms, move_in_date')
    .eq('id', renterId)
    .maybeSingle()

  const { data: property } = await sb
    .from('properties')
    .select(SAFE_PROPERTY_COLS)
    .eq('id', propertyId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!property) return null

  // The renter-linked share row gives us the token (for re-sending the link) + the match for the breakdown.
  const { data: shareRow } = await sb
    .from('property_shares')
    .select('token, match_id')
    .eq('org_id', orgId)
    .eq('property_id', propertyId)
    .eq('renter_id', renterId)
    .maybeSingle()

  const base = (process.env.APP_BASE_URL || 'https://rent360-vert.vercel.app').replace(/\/+$/, '')
  const shareUrl = shareRow?.token ? `${base}/share/${shareRow.token}` : null

  // AI marketing copy (best-effort; the address is already stripped by the processor's prompt).
  let aiDescription: string | null = null
  let aiHighlights: string[] | null = null
  try {
    const processed = await processPropertyForSharing({
      title: property.title || '',
      city: property.city || '',
      neighborhood: property.neighborhood,
      price: property.price || 0,
      rooms: property.rooms,
      sqm: property.sqm,
      description: property.description,
      amenities: property.amenities,
      type: property.type,
      condition: property.condition,
      available_from: property.available_from,
      pets_allowed: property.pets_allowed,
      long_term: property.long_term,
    })
    aiDescription = processed.ai_description
    aiHighlights = processed.ai_highlights
  } catch {/* fall back to raw description below */}

  let match: ReplyContext['match'] = null
  let matchId = shareRow?.match_id as string | null | undefined
  if (!matchId) {
    const { data: m } = await sb
      .from('matches')
      .select('id')
      .eq('org_id', orgId)
      .eq('renter_id', renterId)
      .eq('property_id', propertyId)
      .maybeSingle()
    matchId = m?.id
  }
  if (matchId) match = await buildMatchInfo(sb, matchId)

  return {
    renterId,
    propertyId,
    matchId: matchId ?? null,
    shareUrl,
    renter: {
      firstName: renter?.first_name ?? null,
      budgetMax: renter?.budget_max ?? null,
      preferredRooms: renter?.preferred_rooms ?? null,
      moveInDate: renter?.move_in_date ?? null,
    },
    property: {
      title: property.title ?? null,
      city: property.city ?? null,
      neighborhood: property.neighborhood ?? null,
      price: property.price ?? null,
      rooms: property.rooms ?? null,
      sqm: property.sqm ?? null,
      floor: property.floor ?? null,
      type: property.type ?? null,
      condition: property.condition ?? null,
      petsAllowed: property.pets_allowed ?? null,
      smokersAllowed: property.smokers_allowed ?? null,
      longTerm: property.long_term ?? null,
      availableFrom: property.available_from ?? null,
      amenities: (property.amenities && typeof property.amenities === 'object') ? property.amenities as Record<string, unknown> : null,
      aiDescription: aiDescription || property.description || null,
      aiHighlights,
    },
    match,
  }
}

type MatchInfo = { percentage: number; matches: string[]; missing: string[] }

/** Mirror of `app/api/v1/shares/[token]/route.ts::buildMatchInfo` — % fit + what matches / what's missing. */
async function buildMatchInfo(sb: ReturnType<typeof supabaseService>, matchId: string): Promise<MatchInfo | null> {
  const { data: m } = await sb
    .from('matches')
    .select('score, reasons, breakdown, disqualifying_reasons')
    .eq('id', matchId)
    .maybeSingle()
  if (!m) return null

  const matches = Array.isArray(m.reasons) ? m.reasons.filter((r): r is string => typeof r === 'string') : []
  const missing: string[] = Array.isArray(m.disqualifying_reasons)
    ? m.disqualifying_reasons.filter((r): r is string => typeof r === 'string')
    : []
  const breakdown = (m.breakdown && typeof m.breakdown === 'object') ? m.breakdown as Record<string, any> : {}
  for (const key of ['amenities_must', 'amenities_nice']) {
    const entry = breakdown[key]
    const items = entry && Array.isArray(entry.items) ? entry.items : []
    for (const it of items) {
      if (it && it.has === false && typeof it.label === 'string') missing.push(it.label)
    }
  }
  return { percentage: Math.round(Number(m.score) || 0), matches, missing: Array.from(new Set(missing)) }
}
