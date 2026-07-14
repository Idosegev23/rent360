import { supabaseService } from '../supabase'
import { normalizePhone } from '../whatsapp/meta-provider'

/**
 * Two-level escalation recipients for undocumented human_takeover conversations.
 *  - L1 (24h): שי — the agent expected to close the loop.
 *  - L2 (48h): זיו — manager escalation when it's still untouched a day later.
 *
 * Phones are env-configurable (ESCALATION_L1_PHONE / ESCALATION_L2_PHONE) with the current
 * staff numbers as defaults, and the display name is enriched from `users` by phone. No DDL —
 * a level whose phone resolves empty is simply skipped by the caller.
 */
export type EscalationTarget = { phone: string; name: string }
export type EscalationTargets = { l1: EscalationTarget | null; l2: EscalationTarget | null }

const DEFAULT_L1 = '972527559049' // שי
const DEFAULT_L2 = '972545650748' // זיו

async function resolve(rawPhone: string, fallbackName: string): Promise<EscalationTarget | null> {
  const phone = normalizePhone((rawPhone || '').trim())
  if (!phone) return null
  const { data } = await supabaseService().from('users').select('name').eq('phone', phone).maybeSingle()
  return { phone, name: data?.name || fallbackName }
}

export async function escalationTargets(): Promise<EscalationTargets> {
  const [l1, l2] = await Promise.all([
    resolve(process.env.ESCALATION_L1_PHONE || DEFAULT_L1, 'שי'),
    resolve(process.env.ESCALATION_L2_PHONE || DEFAULT_L2, 'זיו'),
  ])
  return { l1, l2 }
}
