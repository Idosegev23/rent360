import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseService } from '../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../lib/auth'
import { requireOrg } from '../../../../../lib/api/org-context'
import { renterSendCounts, RENTER_PER_DAY_CAP } from '../../../../../lib/outreach/governance'
import { computeMatchesInBackground } from '../../../../../lib/matching/orchestrator'

const LEAD_STATUSES = new Set(['new', 'contacted', 'qualified', 'viewing', 'negotiating', 'placed', 'lost'])
const SOURCES = new Set(['facebook', 'whatsapp', 'referral', 'manual', 'website', 'other'])

// ---- Questionnaire fields (editable via the renter edit dialog) ----
const IDENTITY_FIELDS = new Set(['first_name', 'last_name', 'email'])
const TEXT_FIELDS = ['first_name', 'last_name', 'email', 'employer', 'notes', 'move_in_date']
const INT_FIELDS = ['budget_min', 'budget_max', 'budget_flexibility', 'vaad_bayit_max', 'arnona_max', 'min_sqm', 'floor_min', 'floor_max', 'household_size', 'children_count']
const NUM_FIELDS = ['preferred_rooms']
const BOOL_FIELDS = ['rooms_flexible', 'move_in_flexible', 'has_children', 'has_pets', 'smokers', 'has_payslips', 'has_security_checks', 'has_guarantors']
const ARRAY_FIELDS = ['preferred_cities', 'preferred_neighborhoods']
const ENUM_FIELDS: Record<string, Set<string>> = {
  contract_length: new Set(['6', '12', 'flexible']),
  top_floor_preference: new Set(['any', 'yes', 'no']),
  condition_preference: new Set(['renovated', 'good', 'needs-work', 'any']),
  household_type: new Set(['single', 'couple', 'family', 'roommates', 'students', 'other']),
  employment_status: new Set(['employed', 'self_employed', 'student', 'other']),
}

const asIntN = (v: unknown): number | null => { if (v === '' || v == null) return null; const n = parseInt(String(v), 10); return Number.isFinite(n) ? n : null }
const asNumN = (v: unknown): number | null => { if (v === '' || v == null) return null; const n = parseFloat(String(v)); return Number.isFinite(n) ? n : null }
const asBoolN = (v: unknown): boolean | null => { if (v === true || v === false) return v; if (v === 'true') return true; if (v === 'false') return false; return null }
const asTextN = (v: unknown): string | null => { const s = String(v ?? '').trim(); return s || null }
const asArr = (v: unknown): string[] => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : (typeof v === 'string' ? v.split(/[,\n]/).map(x => x.trim()).filter(Boolean) : [])

// Sanitize the amenity-preferences jsonb to the exact shape the matcher reads. Unknown keys dropped.
const PREF_LEVELS = new Set(['must', 'nice', 'any'])
const PARKING_TYPES = new Set(['any', 'private', 'shared', 'street'])
const PREF_AMOUNTS = new Set(['none', 'partial', 'full', 'any'])
const ACCESS_TYPES = new Set(['any', 'no-stairs', 'ramp', 'wide-door'])
const RANKED_PREFS = ['elevator', 'yard', 'mamad']
const WANTED_PREFS = ['storage', 'solar_heater', 'bars', 'quiet', 'fiber_internet', 'shelter']
const lvl = (v: any): string => { const s = String(v?.level ?? 'any'); return PREF_LEVELS.has(s) ? s : 'any' }
function sanitizePreferences(input: unknown): Record<string, unknown> {
  const p = (input && typeof input === 'object') ? input as Record<string, any> : {}
  const out: Record<string, unknown> = {}
  for (const k of RANKED_PREFS) if (p[k]) out[k] = { level: lvl(p[k]) }
  if (p.parking) out.parking = { level: lvl(p.parking), type: PARKING_TYPES.has(String(p.parking.type)) ? p.parking.type : 'any' }
  if (p.balcony) out.balcony = { level: lvl(p.balcony), min_sqm: asIntN(p.balcony.min_sqm) }
  for (const k of ['furnished', 'aircon']) if (p[k]) out[k] = { level: lvl(p[k]), amount: PREF_AMOUNTS.has(String(p[k].amount)) ? p[k].amount : 'any' }
  if (p.accessibility) out.accessibility = { level: lvl(p.accessibility), type: ACCESS_TYPES.has(String(p.accessibility.type)) ? p.accessibility.type : 'any' }
  for (const k of WANTED_PREFS) if (p[k]) out[k] = { wanted: !!p[k].wanted }
  if ('divided_ok' in p) out.divided_ok = !!p.divided_ok
  return out
}

/** Admin: full renter profile + their org-scoped matches (with property details). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })
  const orgId = user.org_id

  const { data: renter, error } = await sb
    .from('renters')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: { code: 'QUERY_FAILED', message: error.message } }, { status: 500 })
  if (!renter) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })

  // Matches scoped to this org. Sorted: non-DQ by score desc, then DQ.
  const { data: matches } = await sb
    .from('matches')
    .select('id, property_id, score, is_disqualified, disqualifying_reasons, breakdown, reasons, status, updated_at, renter_notified_at')
    .eq('org_id', orgId)
    .eq('renter_id', params.id)
    .order('is_disqualified', { ascending: true })
    .order('score', { ascending: false, nullsFirst: false })
    .limit(50)

  // Hydrate property data for the matches
  const propertyIds = (matches || []).map(m => m.property_id)
  let propertiesById: Record<string, any> = {}
  if (propertyIds.length > 0) {
    const { data: props } = await sb
      .from('properties')
      .select('id, title, city, neighborhood, street, address, price, rooms, sqm, floor, images')
      .in('id', propertyIds)
    propertiesById = Object.fromEntries((props || []).map(p => [p.id, p]))
  }

  // Properties this renter clicked "interested in viewing" on their /share link.
  const { data: interestRows } = await sb
    .from('messages')
    .select('property_id')
    .eq('org_id', orgId)
    .eq('meta_message_type', 'interest')
    .eq('metadata->>renter_id', params.id)
  const interestedPropertyIds = new Set((interestRows || []).map(r => r.property_id))

  const enrichedMatches = (matches || []).map(m => ({
    ...m,
    property: propertiesById[m.property_id] || null,
    interested: interestedPropertyIds.has(m.property_id),
  }))

  // Most recent submission snapshot (for "what they answered")
  const { data: lastSubmission } = await sb
    .from('renter_submissions')
    .select('id, submitted_at, snapshot, invite_token')
    .eq('renter_id', params.id)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Unified send counts for this renter (auto + manual), from matches.renter_notified_at.
  const counts = await renterSendCounts(orgId, [params.id])
  const sendCounts = counts[params.id] || { today: 0, total: 0 }

  return NextResponse.json({
    renter,
    matches: enrichedMatches,
    last_submission: lastSubmission,
    send_counts: sendCounts,
    // The real per-day cap (env-overridable) so the UI badge stays truthful if it changes.
    per_day_cap: RENTER_PER_DAY_CAP,
  })
}

/**
 * Admin: update the renter's CRM layer (lead_status / source / rating / approved_budget /
 * assigned_to). Whitelisted + validated; unknown keys ignored; empty string clears a nullable
 * field. The questionnaire fields are NOT editable here — they come from the intake flow.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  let body: Record<string, any> = {}
  try { body = await req.json() } catch {/* empty body */}

  const update: Record<string, any> = {}
  const bad = (message: string) => NextResponse.json({ error: { code: 'BAD_REQUEST', message } }, { status: 400 })

  if ('lead_status' in body) {
    const v = String(body.lead_status || '')
    if (!LEAD_STATUSES.has(v)) return bad(`invalid lead_status: ${v}`)
    update.lead_status = v
  }
  if ('source' in body) {
    const raw = body.source
    if (raw === null || raw === '') update.source = null
    else {
      const v = String(raw)
      if (!SOURCES.has(v)) return bad(`invalid source: ${v}`)
      update.source = v
    }
  }
  if ('rating' in body) {
    const raw = body.rating
    if (raw === null || raw === '') update.rating = null
    else {
      const n = Number(raw)
      if (!Number.isInteger(n) || n < 1 || n > 5) return bad('rating must be an integer 1-5')
      update.rating = n
    }
  }
  if ('approved_budget' in body) {
    const raw = body.approved_budget
    if (raw === null || raw === '') update.approved_budget = null
    else {
      const n = Number(raw)
      if (!Number.isInteger(n) || n < 0) return bad('approved_budget must be a non-negative integer')
      update.approved_budget = n
    }
  }
  if ('assigned_to' in body) {
    const raw = body.assigned_to
    if (raw === null || raw === '') update.assigned_to = null
    else {
      const v = String(raw)
      const { data: u } = await ctx.sb.from('users').select('id').eq('id', v).eq('org_id', ctx.orgId).maybeSingle()
      if (!u) return bad('assigned_to is not a staff member in this org')
      update.assigned_to = v
    }
  }

  // ---- Questionnaire fields (from the renter edit dialog) ----
  // Track whether any match-affecting field changed, to recompute matches (identity fields don't).
  let touchedMatchable = false
  const markMatchable = (k: string) => { if (!IDENTITY_FIELDS.has(k)) touchedMatchable = true }
  for (const k of TEXT_FIELDS) if (k in body) { update[k] = asTextN(body[k]); markMatchable(k) }
  for (const k of INT_FIELDS) if (k in body) { update[k] = asIntN(body[k]); markMatchable(k) }
  for (const k of NUM_FIELDS) if (k in body) { update[k] = asNumN(body[k]); markMatchable(k) }
  for (const k of BOOL_FIELDS) if (k in body) { update[k] = asBoolN(body[k]); markMatchable(k) }
  for (const k of ARRAY_FIELDS) if (k in body) { update[k] = asArr(body[k]); markMatchable(k) }
  for (const k of Object.keys(ENUM_FIELDS)) if (k in body) {
    const raw = body[k]
    if (raw === '' || raw == null) update[k] = null
    else {
      const v = String(raw)
      if (!ENUM_FIELDS[k]!.has(v)) return bad(`invalid ${k}: ${v}`)
      update[k] = v
    }
    markMatchable(k)
  }
  if ('preferences' in body) { update.preferences = sanitizePreferences(body.preferences); touchedMatchable = true }

  if (Object.keys(update).length === 0) return bad('no updatable fields provided')
  update.updated_at = new Date().toISOString()

  const { data, error } = await ctx.sb.from('renters').update(update).eq('id', params.id).select('*').maybeSingle()
  if (error) return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: error.message } }, { status: 500 })
  if (!data) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })

  // A changed search area / budget / rooms / preferences must refresh apartment matches.
  if (touchedMatchable) { try { computeMatchesInBackground({ renterId: params.id }) } catch {/* best-effort */} }

  return NextResponse.json({ ok: true, renter: data })
}
