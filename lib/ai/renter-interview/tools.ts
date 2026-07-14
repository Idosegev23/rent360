/**
 * Tools for the renter-intake agent. The model saves each collected preference with
 * save_renter_detail (routed to the right renters column / preferences jsonb), then
 * finalize_intake marks the renter vetted + recomputes matches.
 */

import { supabaseService } from '../../supabase'
import { computeMatchesForRenter } from '../../matching/orchestrator'
import { notifyAdminsHandoff } from '../../alerts/admin-whatsapp'
import { normalizeHouseholdType, normalizeEmploymentStatus, parseHebrewMoveIn } from './normalize'

export type RenterToolContext = {
  orgId: string
  threadId: string
  renterId: string
  phone: string
  appBaseUrl?: string | undefined
}

export type ToolDefinition = { type: 'function'; name: string; description: string; parameters: Record<string, unknown> }

const ARRAY_FIELDS = new Set(['preferred_cities', 'preferred_neighborhoods'])
const PREF_LEVEL = new Set(['parking', 'elevator', 'balcony', 'yard', 'furnished', 'aircon', 'mamad', 'accessibility'])
const PREF_WANTED = new Set(['storage', 'solar_heater', 'bars', 'quiet', 'fiber_internet', 'shelter'])
const BOOL_FIELDS = new Set(['rooms_flexible', 'move_in_flexible', 'has_children', 'has_pets', 'smokers', 'has_payslips', 'has_security_checks', 'has_guarantors'])
const SCALAR_FIELDS = new Set([
  'budget_min', 'budget_max', 'budget_flexibility', 'vaad_bayit_max', 'arnona_max', 'contract_length',
  'preferred_rooms', 'min_sqm', 'floor_min', 'floor_max', 'top_floor_preference', 'condition_preference',
  'move_in_date', 'household_type', 'household_size', 'children_count', 'employment_status', 'employer',
  'notes', 'first_name', 'last_name', 'email',
])
const ALL_FIELDS = [
  ...ARRAY_FIELDS, ...PREF_LEVEL, ...PREF_WANTED, ...BOOL_FIELDS, ...SCALAR_FIELDS, 'divided_ok',
] as string[]

export const RENTER_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    name: 'save_renter_detail',
    description: 'Save one preference the renter just gave. Call it every time you learn a fact. Whitelist of fields below; for חובה/יתרון amenities (parking/elevator/balcony/yard/furnished/aircon/mamad/accessibility) value is "must"|"nice"|"any"; for wanted amenities (storage/solar_heater/bars/quiet/fiber_internet/shelter) and booleans value is true/false; divided_ok is true/false (does a divided apartment suit them); preferred_cities/preferred_neighborhoods value is an array of strings; numbers for budget/rooms/sqm/floor/household_size.',
    parameters: {
      type: 'object',
      properties: {
        field: { type: 'string', enum: ALL_FIELDS },
        value: { description: 'string / number / boolean / array depending on the field.' },
      },
      required: ['field', 'value'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'finalize_intake',
    description: 'Call when you have collected the renter\'s preferences (at minimum cities + budget + rooms, ideally most fields). Marks the renter as completed and recomputes their apartment matches. After calling it, tell the renter we will get back to them with matching apartments.',
    parameters: { type: 'object', properties: { summary: { type: 'string', description: 'תקציר קצר של מה שנאסף (עברית).' } }, required: [], additionalProperties: false },
  },
  {
    type: 'function',
    name: 'handoff_to_human',
    description: 'Hand off to a human (Ziv) — when the renter asks for a person or there is something beyond intake.',
    parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'], additionalProperties: false },
  },
]

export async function executeRenterTool(name: string, args: any, ctx: RenterToolContext): Promise<unknown> {
  switch (name) {
    case 'save_renter_detail': {
      const res = await saveDetail(args, ctx)
      // As soon as the core profile (cities + budget + rooms) is in place, promote the
      // renter to "vetted" — don't wait for finalize_intake, which most bot conversations
      // never reach (they trail off near the end). This is what makes a substantially-
      // answered renter show up in the "מילאו שאלון" list instead of vanishing.
      if (res && (res as any).ok) { try { await maybePromote(ctx) } catch {/* best-effort */} }
      return res
    }
    case 'finalize_intake': return finalize(args, ctx)
    case 'handoff_to_human': return handoff(args, ctx)
    default: return { error: `unknown_tool:${name}` }
  }
}

/** Core profile that makes a renter matchable & worth surfacing as "filled the questionnaire". */
function hasCoreProfile(r: { preferred_cities?: unknown; budget_max?: unknown; preferred_rooms?: unknown; rooms_flexible?: unknown }): boolean {
  const cities = Array.isArray(r.preferred_cities) ? r.preferred_cities.filter(Boolean) : []
  return cities.length > 0
    && r.budget_max != null
    && (r.preferred_rooms != null || r.rooms_flexible === true)
}

/**
 * Idempotently mark a renter as vetted (submissions_count ≥ 1) and write a renter_submissions
 * snapshot for audit parity with the web-form path. Safe to call repeatedly: it only bumps the
 * count if it's 0, and only inserts a snapshot if the renter has none yet.
 */
async function ensureVetted(sb: ReturnType<typeof supabaseService>, renterId: string): Promise<void> {
  const { data: r } = await sb.from('renters').select('*').eq('id', renterId).maybeSingle()
  if (!r) return
  if (!r.submissions_count || r.submissions_count < 1) {
    await sb.from('renters').update({ submissions_count: 1, updated_at: new Date().toISOString() }).eq('id', renterId)
  }
  const { data: existing } = await sb.from('renter_submissions').select('id').eq('renter_id', renterId).limit(1)
  if (!existing || existing.length === 0) {
    await sb.from('renter_submissions').insert({
      renter_id: renterId,
      invite_token: null,
      phone: r.phone,
      first_name: r.first_name,
      last_name: r.last_name,
      snapshot: { ...r, source: 'whatsapp_bot' },
      submitted_at: new Date().toISOString(),
    })
  }
}

/** Promote a renter to vetted + compute matches the first time the core profile is complete. */
async function maybePromote(ctx: RenterToolContext): Promise<void> {
  const sb = supabaseService()
  const { data: r } = await sb.from('renters')
    .select('preferred_cities, budget_max, preferred_rooms, rooms_flexible, submissions_count')
    .eq('id', ctx.renterId).maybeSingle()
  if (!r) return
  if (r.submissions_count && r.submissions_count >= 1) return // already vetted — heavy work already done
  if (!hasCoreProfile(r)) return
  await ensureVetted(sb, ctx.renterId)
  try { await computeMatchesForRenter(ctx.renterId) } catch {/* best-effort */}
}

async function saveDetail(args: { field: string; value: unknown }, ctx: RenterToolContext) {
  const { field, value } = args
  if (!ALL_FIELDS.includes(field)) return { error: 'field_not_allowed' }
  const sb = supabaseService()

  // preferences jsonb fields
  if (PREF_LEVEL.has(field) || PREF_WANTED.has(field) || field === 'divided_ok') {
    const { data: r } = await sb.from('renters').select('preferences').eq('id', ctx.renterId).maybeSingle()
    const prefs = (r?.preferences && typeof r.preferences === 'object') ? { ...(r.preferences as Record<string, any>) } : {}
    if (PREF_LEVEL.has(field)) prefs[field] = { level: String(value) }
    else if (PREF_WANTED.has(field)) prefs[field] = { wanted: !!value }
    else prefs.divided_ok = !!value
    const { error } = await sb.from('renters').update({ preferences: prefs, updated_at: new Date().toISOString() }).eq('id', ctx.renterId)
    if (error) return { ok: false, error: error.message }
    return { ok: true, field }
  }

  // Vague move-in date (free text, not ISO) → try to parse an approximate date from a
  // Hebrew month expression ("אמצע אוגוסט"); always mark flexible. Don't silently drop it.
  if (field === 'move_in_date' && !/^\d{4}-\d{2}-\d{2}/.test(String(value))) {
    const parsed = parseHebrewMoveIn(value, new Date())
    const patch: Record<string, unknown> = { move_in_flexible: true, updated_at: new Date().toISOString() }
    if (parsed.date) patch.move_in_date = parsed.date
    await sb.from('renters').update(patch).eq('id', ctx.renterId)
    return { ok: true, field, note: parsed.date ? 'parsed_approx_date' : 'vague_date_marked_flexible' }
  }

  // Rooms given as a range / "doesn't matter" → don't write a misleading single number;
  // mark flexible so the matcher treats rooms as unconstrained instead of penalizing.
  if (field === 'preferred_rooms' && !Number.isFinite(Number(value))) {
    await sb.from('renters').update({ rooms_flexible: true, updated_at: new Date().toISOString() }).eq('id', ctx.renterId)
    return { ok: true, field, note: 'rooms_range_marked_flexible' }
  }

  const NUMERIC = new Set(['budget_min', 'budget_max', 'budget_flexibility', 'vaad_bayit_max', 'arnona_max', 'preferred_rooms', 'min_sqm', 'floor_min', 'floor_max', 'household_size', 'children_count'])
  let v: unknown = value
  if (ARRAY_FIELDS.has(field)) v = Array.isArray(value) ? value : (value != null && value !== '' ? [value] : [])
  else if (BOOL_FIELDS.has(field)) v = !!value
  else if (NUMERIC.has(field)) { const n = Number(value); if (!Number.isFinite(n)) return { ok: true, field, note: 'skipped_non_numeric' }; v = n }
  // Canonicalize free-text enums so bot rows match the web-form's enum values.
  else if (field === 'household_type') v = normalizeHouseholdType(value)
  else if (field === 'employment_status') v = normalizeEmploymentStatus(value)
  else if (!SCALAR_FIELDS.has(field)) return { error: 'field_not_allowed' }

  const { error } = await sb.from('renters').update({ [field]: v, updated_at: new Date().toISOString() }).eq('id', ctx.renterId)
  if (error) return { ok: false, error: error.message }
  return { ok: true, field }
}

async function finalize(args: { summary?: string }, ctx: RenterToolContext) {
  const sb = supabaseService()
  // Append the closing summary note (if any), then ensure vetted + snapshot. ensureVetted is
  // idempotent, so it's harmless whether or not maybePromote already promoted this renter.
  if (args.summary) {
    const { data: r } = await sb.from('renters').select('notes').eq('id', ctx.renterId).maybeSingle()
    const note = `${r?.notes ? r.notes + '\n' : ''}[תשאול בוט ${new Date().toISOString().slice(0, 10)}] ${args.summary}`
    await sb.from('renters').update({ notes: note, updated_at: new Date().toISOString() }).eq('id', ctx.renterId)
  }
  await ensureVetted(sb, ctx.renterId)
  let matches = 0
  try { const res = await computeMatchesForRenter(ctx.renterId); matches = res.inserted } catch {/* best-effort */}
  return { ok: true, vetted: true, matches }
}

async function handoff(args: { reason: string }, ctx: RenterToolContext) {
  const sb = supabaseService()
  await sb.from('threads').update({ status: 'human_takeover' }).eq('id', ctx.threadId)
  try {
    const { data: r } = await sb.from('renters').select('first_name').eq('id', ctx.renterId).maybeSingle()
    const base = ctx.appBaseUrl || process.env.APP_BASE_URL || 'https://rent360-vert.vercel.app'
    await notifyAdminsHandoff({
      threadId: ctx.threadId,
      landlordName: r?.first_name || 'שוכר',
      landlordPhone: ctx.phone,
      propertyTitle: 'תשאול שוכר',
      reason: args.reason || 'שוכר ביקש לדבר עם אדם',
      dashboardUrl: `${base.replace(/\/$/, '')}/inbox/${ctx.threadId}`,
    })
  } catch {/* best-effort */}
  return { ok: true, status: 'human_takeover' }
}
