import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseService } from '../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../lib/auth'
import { normalizePhone } from '../../../../../lib/outreach/phone'

const STATUS_FILTER: Record<string, string[]> = {
  all: [],
  awaiting_reply: ['awaiting_reply'],
  human_takeover: ['human_takeover'],
  closed: ['closed_won', 'closed_lost', 'opted_out'],
  active: ['active', 'awaiting_reply'],
  opted_out: ['opted_out'],
}
// Filters by the detected intent (stored in tags.intent) — "when to talk" pipeline states.
const INTENT_FILTER: Record<string, string[]> = {
  interested: ['interested'],
  price_objection: ['price_objection'],
  callback_later: ['callback_later'],
  not_relevant: ['not_interested', 'already_rented'],
}

// "Dead" conversation = they REPLIED at least once, then we messaged and they went silent for at
// least this long (we're waiting on them). Never-answered threads are excluded on purpose.
// Landlords reply slower than renters, so they get a longer grace window. Tune here.
const DEAD_LANDLORD_HOURS = 48
const DEAD_RENTER_HOURS = 24
// Finished / opted-out threads aren't "dead" — they're closed. Keep them out of this view.
const DEAD_TERMINAL_STATUSES = ['closed_won', 'closed_lost', 'opted_out']

export async function GET(req: NextRequest) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })
  const orgId = user.org_id

  const url = new URL(req.url)
  const filter = url.searchParams.get('filter') || 'all'
  const statuses = STATUS_FILTER[filter] ?? []
  const intents = INTENT_FILTER[filter] ?? []
  const propertyId = url.searchParams.get('propertyId')   // conversations linked to a property
  const renterId = url.searchParams.get('renterId')       // conversations linked to a renter

  let query = sb
    .from('threads')
    .select('id, phone, status, last_message_at, last_inbound_at, last_outbound_at, tags, property_id, opted_out_at')
    .eq('org_id', orgId)
    .eq('channel', 'whatsapp')
    .neq('status', 'admin_alerts')
  if (propertyId) query = query.eq('property_id', propertyId)
  if (renterId) query = query.eq('tags->>renter_id', renterId)

  if (filter === 'dead') {
    // Pre-filter in SQL by the smaller threshold; the exact per-audience cut + the
    // "our message is the latest" (col-to-col) check happen in JS below, since PostgREST
    // can't compare two columns. Order freshly-dead first (most recent outbound) so the
    // still-revivable conversations float to the top, not month-old cold ones.
    const minHours = Math.min(DEAD_LANDLORD_HOURS, DEAD_RENTER_HOURS)
    const cutoffIso = new Date(Date.now() - minHours * 3_600_000).toISOString()
    query = query
      .not('last_inbound_at', 'is', null)
      .not('last_outbound_at', 'is', null)
      .lte('last_outbound_at', cutoffIso)
      .not('status', 'in', `(${DEAD_TERMINAL_STATUSES.join(',')})`)
      .order('last_outbound_at', { ascending: false })
      .limit(200)
  } else {
    if (intents.length > 0) query = query.or(intents.map(i => `tags->>intent.eq.${i}`).join(','))
    else if (statuses.length > 0) query = query.in('status', statuses)
    query = query.order('last_message_at', { ascending: false, nullsFirst: false }).limit(100)
  }

  const { data: threads, error } = await query
  if (error) return NextResponse.json({ error: { code: 'QUERY_FAILED', message: error.message } }, { status: 500 })

  // Hydrate anchor property titles + last message previews in a single round-trip each
  const propertyIds = Array.from(new Set((threads || []).map(t => t.property_id).filter((x): x is string => !!x)))
  const propertyById = new Map<string, { title: string; city: string | null; contact_name: string | null }>()
  if (propertyIds.length > 0) {
    const { data: props } = await sb
      .from('properties')
      .select('id, title, city, contact_name')
      .in('id', propertyIds)
    for (const p of props || []) propertyById.set(p.id, { title: p.title, city: p.city, contact_name: p.contact_name })
  }

  const threadIds = (threads || []).map(t => t.id)
  const previewByThread = new Map<string, { body: string | null; direction: string; created_at: string }>()
  if (threadIds.length > 0) {
    const { data: previews } = await sb
      .from('messages')
      .select('thread_id, body, direction, created_at')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: false })
      .limit(threadIds.length * 5) // fetch generously, we'll dedupe to last-per-thread
    for (const m of previews || []) {
      if (!previewByThread.has(m.thread_id)) {
        previewByThread.set(m.thread_id, { body: m.body, direction: m.direction, created_at: m.created_at })
      }
    }
  }

  // The inbox is landlord-oriented: it labels a thread with the linked property's owner.
  // Renter threads (tags.audience === 'renter') are linked to the RECOMMENDED property, so
  // that label would wrongly show the property owner — resolve the renter's name instead.
  const hasRenterThreads = (threads || []).some(t => {
    const tg = (t.tags && typeof t.tags === 'object') ? (t.tags as Record<string, unknown>) : {}
    return tg.audience === 'renter'
  })
  const renterNameByPhone = new Map<string, string>()
  if (hasRenterThreads) {
    const { data: renters } = await sb.from('renters').select('first_name, last_name, phone')
    for (const r of renters || []) {
      if (!r.phone) continue
      const nm = [r.first_name, r.last_name].filter(Boolean).join(' ').trim()
      if (nm) renterNameByPhone.set(normalizePhone(r.phone), nm)
    }
  }

  const rows = (threads || []).map(t => {
    const prop = t.property_id ? propertyById.get(t.property_id) : undefined
    const preview = previewByThread.get(t.id)
    const tags = (t.tags && typeof t.tags === 'object') ? (t.tags as Record<string, unknown>) : {}
    const audience = tags.audience === 'renter' ? 'renter' : 'landlord'
    const tagRenterName = typeof tags.renter_name === 'string' ? tags.renter_name : null
    const displayName = audience === 'renter'
      ? (tagRenterName || (t.phone ? renterNameByPhone.get(normalizePhone(t.phone)) : null) || null)
      : (prop?.contact_name || null)
    return {
      id: t.id,
      phone: t.phone,
      status: t.status,
      last_message_at: t.last_message_at,
      last_inbound_at: t.last_inbound_at,
      last_outbound_at: t.last_outbound_at,
      opted_out_at: t.opted_out_at,
      intent: typeof tags.intent === 'string' ? tags.intent : null,
      audience,
      landlord_name: displayName,
      property_title: prop?.title || null,
      property_city: prop?.city || null,
      preview: preview ? {
        body: preview.body,
        direction: preview.direction,
        created_at: preview.created_at,
      } : null,
    }
  })

  let outRows = rows
  if (filter === 'dead') {
    const now = Date.now()
    outRows = rows.filter(r => {
      if (!r.last_inbound_at || !r.last_outbound_at) return false
      // Our last message must be AFTER their last reply — i.e. the ball is in their court.
      if (new Date(r.last_outbound_at).getTime() <= new Date(r.last_inbound_at).getTime()) return false
      const silentMs = now - new Date(r.last_outbound_at).getTime()
      const thresholdHours = r.audience === 'landlord' ? DEAD_LANDLORD_HOURS : DEAD_RENTER_HOURS
      return silentMs >= thresholdHours * 3_600_000
    })
  }

  return NextResponse.json({ threads: outRows, filter })
}
