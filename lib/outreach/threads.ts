/**
 * Thread upsert-by-(org_id, phone) helper shared by every outbound-dispatch
 * path that needs "find or create the WhatsApp thread for this recipient"
 * (the landlord first-touch dispatcher and the renewal dispatcher today).
 * Extracted out of `lib/outreach/dispatcher.ts` (fix round 1 of Task 7) so
 * thread-identity logic lives in exactly one place — two copies would drift
 * the first time anyone adds a column or changes thread status.
 *
 * Looks up the existing thread ordered by `last_message_at` DESC (most
 * recently active first) and takes the top row via `.limit(1)` rather than
 * `.maybeSingle()`. `(org_id, phone)` has no unique constraint at the DB
 * level — 12 duplicate pairs exist in production today — and `.maybeSingle()`
 * throws when more than one row matches. Both prior copies of this helper
 * destructured only `data` (not `error`) from that call, so the thrown error
 * was silently discarded, `existing` came back `undefined`, and the
 * "not found" branch inserted a THIRD duplicate thread on every send to an
 * already-duplicated recipient — landing the outbound message on a fresh,
 * disconnected thread instead of the live conversation. Ordering + limit(1)
 * never throws on multiple matches and resolves deterministically to the
 * most active existing thread instead of compounding the duplication.
 */

import { supabaseService } from '../supabase'

export async function upsertThread(
  sb: ReturnType<typeof supabaseService>,
  orgId: string,
  normalizedPhone: string,
  propertyId: string,
): Promise<{ id: string }> {
  const { data: existing } = await sb
    .from('threads')
    .select('id')
    .eq('org_id', orgId)
    .eq('phone', normalizedPhone)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
  const found = existing?.[0]
  if (found) return found
  const { data: created, error: insertError } = await sb
    .from('threads')
    .insert({
      org_id: orgId,
      phone: normalizedPhone,
      channel: 'whatsapp',
      status: 'awaiting_reply',
      property_id: propertyId,
    })
    .select('id')
    .single()
  // Both dispatchers call this AFTER `sendTemplate` already delivered the WhatsApp message —
  // a thrown TypeError here (from the old `created!` non-null assertion, on a failed insert)
  // 500s the route before the lead/property is ever stamped 'sent', so the next batch resends
  // the same cold marketing message to the same person. Throwing a descriptive error instead
  // still fails the request, but at least surfaces the real cause instead of "created is not
  // defined" — and callers can be extended later to fall back to a lookup-by-phone retry.
  if (insertError || !created) {
    throw new Error(`upsertThread: thread insert failed for org=${orgId} phone=${normalizedPhone}: ${insertError?.message || 'no row returned'}`)
  }
  return created
}
