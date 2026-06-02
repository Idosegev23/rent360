import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { requireAdminOrg } from '../../../../../lib/outreach/admin-context'
import { normalizePhone } from '../../../../../lib/outreach/phone'
import {
  DAILY_CAP,
  templatesSentToday,
  loadSuppressedPhones,
  loadApprovedPropertyIds,
  recipientMessageCounts,
} from '../../../../../lib/outreach/governance'

/**
 * Landlord recruitment queue (review-and-send).
 *
 * Returns unapproved property owners who are eligible for a first-touch outreach,
 * excluding: already-messaged, owner-blocked, already-approved (approved_properties),
 * and suppressed phones. SQL filters are a coarse upper bound — the dispatcher still
 * skips rows with an unusable name/street/rooms at send time and reports the reason.
 *
 * Query params (all optional): city, hasImages=1, createdAfter, createdBefore, limit, offset.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireAdminOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { orgId } = ctx
  const sb = supabaseService()

  const url = req.nextUrl
  const city = url.searchParams.get('city')?.trim() || null
  const hasImages = url.searchParams.get('hasImages') === '1'
  const createdAfter = url.searchParams.get('createdAfter')
  const createdBefore = url.searchParams.get('createdBefore')
  const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 100))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0)

  const [approvedIds, suppressed] = await Promise.all([
    loadApprovedPropertyIds(orgId),
    loadSuppressedPhones(orgId),
  ])

  let q = sb
    .from('properties')
    .select('id, contact_name, contact_phone, city, neighborhood, street, address, rooms, price, images, created_at')
    .eq('org_id', orgId)
    .eq('initial_message_sent', false)
    .eq('outreach_blocked', false)
    .not('contact_phone', 'is', null)
    .not('contact_name', 'is', null)
    .neq('contact_name', '')
    .or('is_active.is.null,is_active.eq.true')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit * 3 - 1) // over-fetch to absorb JS-side exclusions

  if (city) q = q.eq('city', city)
  if (createdAfter) q = q.gte('created_at', createdAfter)
  if (createdBefore) q = q.lte('created_at', createdBefore)

  const { data: candidates, error } = await q
  if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })

  const rows: Array<{
    propertyId: string
    contactName: string | null
    phone: string
    city: string | null
    location: string | null
    rooms: number | null
    price: number | null
    coverImage: string | null
    createdAt: string
  }> = []

  for (const p of candidates || []) {
    if (rows.length >= limit) break
    if (approvedIds.has(p.id)) continue
    const rawPhone = (p.contact_phone || '').trim()
    if (!rawPhone) continue
    if (suppressed.has(normalizePhone(rawPhone))) continue
    const images: string[] = Array.isArray(p.images)
      ? p.images.filter((u): u is string => typeof u === 'string' && u.startsWith('http'))
      : []
    if (hasImages && images.length === 0) continue
    rows.push({
      propertyId: p.id,
      contactName: p.contact_name,
      phone: rawPhone,
      city: p.city,
      location: p.neighborhood ? `${p.city || ''} · ${p.neighborhood}` : (p.street || p.city || null),
      rooms: p.rooms ?? null,
      price: p.price ?? null,
      coverImage: images[0] || null,
      createdAt: p.created_at,
    })
  }

  const [sentToday, counts] = await Promise.all([
    templatesSentToday(orgId),
    recipientMessageCounts(orgId, rows.map(r => r.phone)),
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
    },
    // True when the over-fetch was exhausted — there are very likely more pages.
    hasMore: (candidates?.length || 0) >= limit * 3,
  })
}
