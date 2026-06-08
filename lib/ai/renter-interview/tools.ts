/**
 * Tools for the renter-intake agent. The model saves each collected preference with
 * save_renter_detail (routed to the right renters column / preferences jsonb), then
 * finalize_intake marks the renter vetted + recomputes matches.
 */

import { supabaseService } from '../../supabase'
import { computeMatchesForRenter } from '../../matching/orchestrator'
import { notifyAdminsHandoff } from '../../alerts/admin-whatsapp'

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
    case 'save_renter_detail': return saveDetail(args, ctx)
    case 'finalize_intake': return finalize(args, ctx)
    case 'handoff_to_human': return handoff(args, ctx)
    default: return { error: `unknown_tool:${name}` }
  }
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

  // Vague move-in date (free text, not ISO) → don't write the date column; mark flexible.
  if (field === 'move_in_date' && !/^\d{4}-\d{2}-\d{2}/.test(String(value))) {
    await sb.from('renters').update({ move_in_flexible: true, updated_at: new Date().toISOString() }).eq('id', ctx.renterId)
    return { ok: true, field, note: 'vague_date_marked_flexible' }
  }

  const NUMERIC = new Set(['budget_min', 'budget_max', 'budget_flexibility', 'vaad_bayit_max', 'arnona_max', 'preferred_rooms', 'min_sqm', 'floor_min', 'floor_max', 'household_size', 'children_count'])
  let v: unknown = value
  if (ARRAY_FIELDS.has(field)) v = Array.isArray(value) ? value : (value != null && value !== '' ? [value] : [])
  else if (BOOL_FIELDS.has(field)) v = !!value
  else if (NUMERIC.has(field)) { const n = Number(value); if (!Number.isFinite(n)) return { ok: true, field, note: 'skipped_non_numeric' }; v = n }
  else if (!SCALAR_FIELDS.has(field)) return { error: 'field_not_allowed' }

  const { error } = await sb.from('renters').update({ [field]: v, updated_at: new Date().toISOString() }).eq('id', ctx.renterId)
  if (error) return { ok: false, error: error.message }
  return { ok: true, field }
}

async function finalize(args: { summary?: string }, ctx: RenterToolContext) {
  const sb = supabaseService()
  const { data: r } = await sb.from('renters').select('submissions_count, notes').eq('id', ctx.renterId).maybeSingle()
  const count = (r?.submissions_count || 0) + 1
  const note = args.summary ? `${r?.notes ? r.notes + '\n' : ''}[תשאול בוט ${new Date().toISOString().slice(0, 10)}] ${args.summary}` : r?.notes
  await sb.from('renters').update({ submissions_count: count, notes: note, updated_at: new Date().toISOString() }).eq('id', ctx.renterId)
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
