import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { requireAdminOrg } from '../../../../../lib/outreach/admin-context'
import { normalizePhone } from '../../../../../lib/outreach/phone'
import {
  DAILY_CAP,
  RENTER_MIN_SCORE,
  templatesSentToday,
  loadSuppressedPhones,
  recipientMessageCounts,
} from '../../../../../lib/outreach/governance'

const RENTER_TEMPLATE = 'renter_match_alert_v1'

/**
 * Renter recommendations queue.
 *
 * One row per renter — their single best NEW, high-quality match — to avoid flooding.
 * Eligible: renter_notified_at IS NULL, not disqualified, score >= threshold, renter has a
 * non-suppressed phone, property has the fields the template needs (image+rooms+price+city).
 *
 * Query params (optional): minScore, limit.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireAdminOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { orgId } = ctx
  const sb = supabaseService()

  const url = req.nextUrl
  const minScore = (() => {
    const n = parseFloat(url.searchParams.get('minScore') || '')
    return Number.isFinite(n) ? n : RENTER_MIN_SCORE
  })()
  const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 100))

  const { data: matches, error } = await sb
    .from('matches')
    .select('id, renter_id, property_id, score')
    .eq('org_id', orgId)
    .is('renter_notified_at', null)
    .eq('is_disqualified', false)
    .gte('score', minScore)
    .order('score', { ascending: false })
    .limit(1000)
  if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })

  // Resolve renters + properties referenced by the candidate matches.
  const renterIds = Array.from(new Set((matches || []).map(m => m.renter_id).filter(Boolean)))
  const propertyIds = Array.from(new Set((matches || []).map(m => m.property_id).filter(Boolean)))

  const [{ data: renters }, { data: props }, suppressed] = await Promise.all([
    renterIds.length
      ? sb.from('renters').select('id, first_name, phone').in('id', renterIds)
      : Promise.resolve({ data: [] as any[] }),
    propertyIds.length
      ? sb.from('properties').select('id, city, neighborhood, rooms, price, images').in('id', propertyIds)
      : Promise.resolve({ data: [] as any[] }),
    loadSuppressedPhones(orgId),
  ])

  const renterMap = new Map<string, { first_name: string | null; phone: string | null }>()
  for (const r of renters || []) renterMap.set(r.id, { first_name: r.first_name, phone: r.phone })
  const propMap = new Map<string, any>()
  for (const p of props || []) propMap.set(p.id, p)

  // Walk matches best-first; keep the single best eligible match per renter.
  const seenRenter = new Set<string>()
  const rows: Array<{
    matchId: string
    renterId: string
    renterName: string | null
    phone: string
    propertyId: string
    location: string | null
    rooms: number | null
    price: number | null
    coverImage: string | null
    score: number
  }> = []

  for (const m of matches || []) {
    if (rows.length >= limit) break
    if (seenRenter.has(m.renter_id)) continue
    const renter = renterMap.get(m.renter_id)
    if (!renter?.phone) continue
    const normPhone = normalizePhone(renter.phone)
    if (suppressed.has(normPhone)) continue
    const p = propMap.get(m.property_id)
    if (!p) continue
    const images: string[] = Array.isArray(p.images)
      ? p.images.filter((u: unknown): u is string => typeof u === 'string' && u.startsWith('http'))
      : []
    if (images.length === 0) continue
    if (p.rooms === null || p.rooms === undefined) continue
    if (p.price === null || p.price === undefined) continue
    if (!p.city) continue

    seenRenter.add(m.renter_id)
    rows.push({
      matchId: m.id,
      renterId: m.renter_id,
      renterName: renter.first_name,
      phone: renter.phone,
      propertyId: m.property_id,
      location: p.neighborhood ? `${p.city} · ${p.neighborhood}` : p.city,
      rooms: p.rooms ?? null,
      price: p.price ?? null,
      coverImage: images[0] || null,
      score: Number(m.score),
    })
  }

  const [sentToday, counts, { data: tpl }] = await Promise.all([
    templatesSentToday(orgId),
    recipientMessageCounts(orgId, rows.map(r => r.phone)),
    sb.from('whatsapp_templates').select('status').eq('name', RENTER_TEMPLATE).eq('language', 'he').maybeSingle(),
  ])

  const enriched = rows.map(r => ({
    ...r,
    received: counts[normalizePhone(r.phone)] || { today: 0, week: 0 },
  }))

  return NextResponse.json({
    ok: true,
    rows: enriched,
    counters: {
      sentToday,
      dailyCap: DAILY_CAP,
      remaining: Math.max(0, DAILY_CAP - sentToday),
      minScore,
    },
    templateApproved: tpl?.status === 'approved',
  })
}
