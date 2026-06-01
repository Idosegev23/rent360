/**
 * Opt-out / suppression list management.
 *
 * Three entry points the codebase uses:
 *  - `isSuppressed` — gate every outbound message before it goes out.
 *  - `recordOptOut` — write to the suppression list, flip the property,
 *    update the thread. Called by the webhook (interactive button or
 *    hard-match stop-word) and by the AI tool `opt_out_landlord`.
 *  - `isHardOptOut` — narrow regex that triggers the deterministic
 *    opt-out path. Everything ambiguous goes through the AI agent
 *    instead, so context like "השוכר הקודם לא היה מעוניין בחוזה ארוך"
 *    is not mis-flagged.
 */

import { supabaseService } from '../supabase'
import { normalizePhone } from './phone'

// Matches the deterministic opt-out phrases, including the exact quick-reply
// button label "להסיר אותי" used by the landlord_outreach_* templates. The
// `אותי` suffix is optional on every הסר/להסיר/תסירו variant, not just "הסר".
const HARD_OPT_OUT_RE = /^\s*(STOP|תפסיק|אל\s+תשלח\s+לי|לא\s+מעוניי[ןנ]ת?|(?:ל?הסיר[וי]?|תסיר[וי]?|הסר)(?:\s+אותי)?)\s*$/i

export function isHardOptOut(body: string | null | undefined): boolean {
  if (!body) return false
  return HARD_OPT_OUT_RE.test(body)
}

export async function isSuppressed(orgId: string, phone: string): Promise<boolean> {
  const sb = supabaseService()
  const { data } = await sb
    .from('whatsapp_suppression')
    .select('id')
    .eq('org_id', orgId)
    .eq('phone', normalizePhone(phone))
    .maybeSingle()
  return !!data
}

export type OptOutInput = {
  orgId: string
  phone: string
  reason?: string | undefined
  source: 'button' | 'stopword' | 'ai_tool' | 'manual'
}

export async function recordOptOut(input: OptOutInput): Promise<{ inserted: boolean }> {
  const sb = supabaseService()
  const phone = normalizePhone(input.phone)

  // Idempotent insert into suppression list
  const { error: insertErr } = await sb
    .from('whatsapp_suppression')
    .insert({
      org_id: input.orgId,
      phone,
      reason: input.reason || null,
      source: input.source,
    })
  // Unique constraint on (org_id, phone) — ignore duplicate
  const alreadyExists = insertErr?.code === '23505'
  if (insertErr && !alreadyExists) {
    throw new Error(`recordOptOut suppression insert failed: ${insertErr.message}`)
  }

  // Flip outreach_blocked on every property sharing this phone in this org.
  // Use normalized variants — properties were imported with raw phones, so try both.
  const variants = phoneVariants(input.phone)
  await sb
    .from('properties')
    .update({ outreach_blocked: true })
    .eq('org_id', input.orgId)
    .in('contact_phone', variants)

  // Close any open threads for this phone
  await sb
    .from('threads')
    .update({ status: 'opted_out', opted_out_at: new Date().toISOString() })
    .eq('org_id', input.orgId)
    .eq('phone', phone)

  return { inserted: !alreadyExists }
}

/** Return the most common variants of an Israeli mobile so we can match scraped values. */
function phoneVariants(raw: string): string[] {
  const digits = raw.replace(/[^\d+]/g, '')
  const variants = new Set<string>([digits])
  if (digits.startsWith('+972')) {
    variants.add('0' + digits.slice(4))
    variants.add('972' + digits.slice(4))
  } else if (digits.startsWith('972')) {
    variants.add('+972' + digits.slice(3))
    variants.add('0' + digits.slice(3))
  } else if (digits.startsWith('0')) {
    variants.add('972' + digits.slice(1))
    variants.add('+972' + digits.slice(1))
  }
  return Array.from(variants)
}
