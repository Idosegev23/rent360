/**
 * Anti-flood governance for the Outreach Control Center.
 *
 * Two layers (see docs/superpowers/specs/2026-06-02-outreach-control-center-design.md):
 *  - Automatic / batch sends ENFORCE the caps here (daily cap, per-renter/day, jitter).
 *  - Manual single sends BYPASS the rate caps (the dispatchers themselves carry no cap),
 *    but the UI shows these counters so the operator can self-govern. Opt-out / suppression
 *    is never bypassed — that lives in the dispatchers, not here.
 *
 * v1 reads all knobs from env with safe defaults; UI-editable settings are deferred.
 */

import { supabaseService } from '../supabase'
import { normalizePhone } from './phone'

const intEnv = (name: string, def: number): number => {
  const n = parseInt(process.env[name] || '', 10)
  return Number.isFinite(n) && n > 0 ? n : def
}

/** Shared daily template cap across landlord + renter sends (total/day). */
export const DAILY_CAP = intEnv('OUTREACH_DAILY_CAP', 250)
/** Only matches at/above this score are "hot" enough to alert a renter. */
export const RENTER_MIN_SCORE = (() => {
  const n = parseFloat(process.env.RENTER_ALERT_MIN_SCORE || '')
  return Number.isFinite(n) ? n : 70
})()
/** Max recommendations per renter per day in the automatic/batch path. */
export const RENTER_PER_DAY_CAP = intEnv('RENTER_PER_DAY_CAP', 1)
/** Randomized inter-send delay so traffic looks organic and spreads load. */
export const JITTER_MIN_MS = intEnv('OUTREACH_JITTER_MIN_MS', 1500)
export const JITTER_MAX_MS = intEnv('OUTREACH_JITTER_MAX_MS', 3000)
/** Hard cap on rows sent per manual batch click (send in ~50s, not 250 at once + timeout-safe). */
export const MANUAL_BATCH_MAX = intEnv('OUTREACH_MANUAL_BATCH_MAX', 50)

export type RecipientCount = { today: number; week: number }

function utcDayStartIso(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

function weekStartIso(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 7)
  return d.toISOString()
}

/** Sleep a randomized jitter interval between sends. */
export function sleepJitter(): Promise<void> {
  const span = Math.max(0, JITTER_MAX_MS - JITTER_MIN_MS)
  const ms = JITTER_MIN_MS + Math.floor(Math.random() * (span + 1))
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Count of outbound template messages sent today (the shared daily cap is measured against this). */
export async function templatesSentToday(orgId: string): Promise<number> {
  const sb = supabaseService()
  const { count } = await sb
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('direction', 'out')
    .eq('meta_message_type', 'template')
    .gte('created_at', utcDayStartIso())
  return count || 0
}

/** Normalized phones that must never be messaged (opt-out / manual blocklist). */
export async function loadSuppressedPhones(orgId: string): Promise<Set<string>> {
  const sb = supabaseService()
  const { data } = await sb.from('whatsapp_suppression').select('phone').eq('org_id', orgId)
  return new Set((data || []).map(r => normalizePhone(r.phone)))
}

/** Property ids that already have an approved-brokerage row (exclude from the recruitment queue). */
export async function loadApprovedPropertyIds(orgId: string): Promise<Set<string>> {
  const sb = supabaseService()
  const { data } = await sb.from('approved_properties').select('property_id').eq('org_id', orgId)
  return new Set((data || []).map(r => r.property_id as string))
}

/**
 * Per-recipient outbound counts (today + last 7 days) for the indicator badge.
 * messages have no phone column, so we go phone → thread → messages.
 */
export async function recipientMessageCounts(
  orgId: string,
  phones: string[],
): Promise<Record<string, RecipientCount>> {
  const normalized = Array.from(new Set(phones.map(normalizePhone))).filter(Boolean)
  const out: Record<string, RecipientCount> = {}
  for (const p of normalized) out[p] = { today: 0, week: 0 }
  if (normalized.length === 0) return out

  const sb = supabaseService()
  const { data: threads } = await sb
    .from('threads')
    .select('id, phone')
    .eq('org_id', orgId)
    .in('phone', normalized)
  if (!threads || threads.length === 0) return out

  const threadToPhone = new Map<string, string>()
  for (const t of threads) threadToPhone.set(t.id, normalizePhone(t.phone))
  const threadIds = Array.from(threadToPhone.keys())

  const { data: msgs } = await sb
    .from('messages')
    .select('thread_id, created_at')
    .eq('org_id', orgId)
    .eq('direction', 'out')
    .in('thread_id', threadIds)
    .gte('created_at', weekStartIso())
  if (!msgs) return out

  const dayStart = utcDayStartIso()
  for (const m of msgs) {
    const phone = threadToPhone.get(m.thread_id as string)
    if (!phone) continue
    const entry = out[phone]
    if (!entry) continue
    entry.week += 1
    if ((m.created_at as string) >= dayStart) entry.today += 1
  }
  return out
}
