import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserIdFromSupabaseCookie } from '../../../../lib/auth'
import { supabaseService } from '../../../../lib/supabase'

/**
 * Action Center — turns the signals the AI already detects (landlord intent, brokerage
 * approvals, renter interest) into a prioritized "what to do now" list, so the operator
 * doesn't have to dig. Read-only aggregation; cookie-auth (org-scoped).
 */
export const dynamic = 'force-dynamic'

type Item = {
  thread_id?: string | undefined
  property_id?: string | undefined
  label: string
  sublabel?: string | undefined
  note?: string | undefined
  since?: string | null | undefined
  badge?: string | undefined
  href: string
}

function propLabel(p: any): { label: string; sublabel: string } {
  if (!p) return { label: 'נכס', sublabel: '' }
  const cityClean = (p.city || '').replace(/\s*-\s*(מגורים|משרדים|rent).*$/i, '').trim()
  const addr = [p.street, cityClean].filter(Boolean).join(', ') || cityClean || p.title || 'נכס'
  const bits: string[] = []
  if (p.rooms) bits.push(`${p.rooms} חד׳`)
  if (p.price) bits.push(`₪${Number(p.price).toLocaleString('he-IL')}`)
  return { label: addr, sublabel: bits.join(' · ') }
}

// Dismissed via "בוצע" — hidden until the lead has new activity (a message after the dismissal).
function isDone(tags: any, lastMsg: string | null): boolean {
  const d = tags?.action_done_at
  if (!d) return false
  if (!lastMsg) return true
  return new Date(String(d)).getTime() >= new Date(String(lastMsg)).getTime()
}

export async function GET(_req: NextRequest) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })
  const orgId = user.org_id
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999)
  const todayISO = todayEnd.toISOString()

  // 1) Threads that carry a detected intent (landlord conversations).
  const { data: intentThreads } = await sb
    .from('threads')
    .select('id, phone, property_id, tags, last_inbound_at, last_message_at, status')
    .eq('org_id', orgId)
    .not('tags->>intent', 'is', null)
    .order('last_message_at', { ascending: false })
    .limit(300)

  // 2) Renter interests (renter clicked "מעוניין/ת לראות").
  const { data: interestThreads } = await sb
    .from('threads')
    .select('id, property_id, tags, last_inbound_at, last_message_at')
    .eq('org_id', orgId)
    .eq('tags->>interested', 'true')
    .order('last_message_at', { ascending: false })
    .limit(50)

  // 3) Recently approved properties.
  const { data: approvedRows } = await sb
    .from('approved_properties')
    .select('property_id, approved_at, approval_method')
    .eq('org_id', orgId)
    .order('approved_at', { ascending: false })
    .limit(100)
  const approvedIds = new Set((approvedRows || []).map(a => a.property_id))

  // Collect every property id we need a label for, and fetch in one shot.
  const propIds = Array.from(new Set([
    ...((intentThreads || []).map(t => t.property_id).filter(Boolean) as string[]),
    ...((interestThreads || []).map(t => t.property_id).filter(Boolean) as string[]),
    ...((approvedRows || []).map(a => a.property_id).filter(Boolean) as string[]),
  ]))
  const propById = new Map<string, any>()
  if (propIds.length) {
    const { data: props } = await sb
      .from('properties')
      .select('id, title, city, street, price, rooms, contact_name')
      .in('id', propIds)
      .eq('org_id', orgId)
    for (const p of props || []) propById.set(p.id, p)
  }

  // Match counts (non-DQ) for approved properties → "ready to send to renters".
  const matchCount = new Map<string, number>()
  const approvedPropIds = (approvedRows || []).map(a => a.property_id).filter(Boolean) as string[]
  if (approvedPropIds.length) {
    const { data: matchRows } = await sb
      .from('matches')
      .select('property_id, is_disqualified')
      .eq('org_id', orgId)
      .in('property_id', approvedPropIds)
      .eq('is_disqualified', false)
    for (const m of matchRows || []) matchCount.set((m as any).property_id, (matchCount.get((m as any).property_id) || 0) + 1)
  }

  const hot_leads: Item[] = []
  const price_objections: Item[] = []
  const callbacks_due: Item[] = []

  for (const t of intentThreads || []) {
    const tags = (t.tags && typeof t.tags === 'object' ? t.tags : {}) as Record<string, any>
    if (isDone(tags, t.last_message_at)) continue // dismissed ("בוצע") and no new activity since
    const intent = tags.intent
    const p = t.property_id ? propById.get(t.property_id) : null
    const { label, sublabel } = propLabel(p)
    const name = p?.contact_name || 'בעל דירה'
    const base: Item = {
      thread_id: t.id,
      label: `${name} — ${label}`,
      sublabel,
      note: tags.intent_notes ? String(tags.intent_notes).slice(0, 120) : undefined,
      since: tags.intent_set_at || t.last_message_at || null,
      href: `/inbox/${t.id}`,
    }
    if (intent === 'interested') {
      if (t.property_id && approvedIds.has(t.property_id)) continue // already approved → not a pending action
      hot_leads.push(base)
    } else if (intent === 'price_objection') {
      price_objections.push(base)
    } else if (intent === 'callback_later') {
      const due = !tags.callback_at || String(tags.callback_at) <= todayISO.slice(0, 10) || String(tags.callback_at) <= todayISO
      if (due) callbacks_due.push({ ...base, badge: tags.callback_at ? `נקבע: ${String(tags.callback_at).slice(0, 10)}` : 'ללא תאריך' })
    }
  }

  const approved_to_send: Item[] = (approvedRows || []).map(a => {
    const p = propById.get(a.property_id)
    const { label, sublabel } = propLabel(p)
    const mc = matchCount.get(a.property_id) || 0
    return {
      property_id: a.property_id,
      label,
      sublabel,
      badge: mc > 0 ? `${mc} שוכרים מתאימים` : 'אין התאמות עדיין',
      since: a.approved_at,
      href: '/approved-properties',
    } as Item
  }).filter(it => (it.badge || '').includes('שוכרים')) // surface ones with matches to act on
    .slice(0, 20)

  const renter_interests: Item[] = (interestThreads || []).filter(t => {
    const tags = (t.tags && typeof t.tags === 'object' ? t.tags : {}) as Record<string, any>
    return !isDone(tags, t.last_message_at)
  }).map(t => {
    const tags = (t.tags && typeof t.tags === 'object' ? t.tags : {}) as Record<string, any>
    const p = t.property_id ? propById.get(t.property_id) : null
    const { label } = propLabel(p)
    return {
      thread_id: t.id,
      label: `${tags.renter_name || 'שוכר'} — מעוניין/ת`,
      sublabel: label,
      since: t.last_inbound_at || t.last_message_at || null,
      href: `/inbox/${t.id}`,
    } as Item
  })

  const lanes = {
    hot_leads: { count: hot_leads.length, items: hot_leads.slice(0, 20) },
    price_objections: { count: price_objections.length, items: price_objections.slice(0, 20) },
    callbacks_due: { count: callbacks_due.length, items: callbacks_due.slice(0, 20) },
    approved_to_send: { count: approved_to_send.length, items: approved_to_send },
    renter_interests: { count: renter_interests.length, items: renter_interests.slice(0, 20) },
  }

  const total = Object.values(lanes).reduce((s, l) => s + l.count, 0)
  return NextResponse.json({ generated_at: new Date().toISOString(), total, lanes })
}
