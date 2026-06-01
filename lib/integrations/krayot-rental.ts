/**
 * Auto-enrolls a rent360 renter into the krayot-rental consumer app.
 *
 * The two apps share one Supabase project, so the same `auth.users` table
 * backs both. After a renter completes the questionnaire we:
 *
 *   1. Invite them by email via Supabase Admin (`inviteUserByEmail`). This
 *      sends an email with a one-click link where they set their own
 *      password and land directly in the renter app.
 *   2. Upsert a row into `krayot_profiles` with the data they just gave us
 *      so they don't have to re-fill anything on the consumer side.
 *
 * The whole thing is fire-and-forget from the submit handler — the renter
 * sees the success screen immediately, and the invite email lands shortly
 * after. We never block on email delivery.
 */

import { supabaseService } from '../supabase'

export const KRAYOT_RENTAL_URL = 'https://rent360-app.vercel.app'

export type EnrollmentResult =
  | { ok: true; created: boolean; userId: string }
  | { ok: false; reason: 'no_email' | 'invite_failed' | 'profile_failed' | 'renter_not_found'; message?: string | undefined }

export async function enrollRenterInKrayotRental(renterId: string): Promise<EnrollmentResult> {
  const sb = supabaseService()

  const { data: renter, error: rerr } = await sb
    .from('renters')
    .select(`
      id, first_name, last_name, phone, email,
      preferred_cities, preferred_neighborhoods, preferred_rooms,
      budget_min, budget_max, household_type, household_size,
      has_children, children_count, has_pets, smokers, move_in_date,
      employment_status, employer, monthly_income,
      has_payslips, has_security_checks, has_guarantors,
      preferences, match_weights, notes
    `)
    .eq('id', renterId)
    .maybeSingle()

  if (rerr || !renter) {
    return { ok: false, reason: 'renter_not_found', message: rerr?.message }
  }
  if (!renter.email) {
    return { ok: false, reason: 'no_email' }
  }

  const fullName = [renter.first_name, renter.last_name].filter(Boolean).join(' ').trim() || null

  // 1) Invite by email. Idempotent in practice: if the email is already
  //    registered, supabase returns a 422 with a specific code and we still
  //    proceed to upsert the profile.
  let userId: string | null = null
  let created = false

  try {
    const { data: invited, error: inviteErr } = await (sb.auth as any).admin.inviteUserByEmail(
      renter.email,
      {
        redirectTo: `${KRAYOT_RENTAL_URL}/auth/callback`,
        data: {
          first_name: renter.first_name,
          last_name:  renter.last_name,
          full_name:  fullName,
          phone:      renter.phone,
        },
      },
    )

    if (inviteErr) {
      // "User already registered" / "already exists" → fall through and
      // look the user up so we can still sync the profile.
      const msg = inviteErr.message || ''
      const exists = /already (registered|exists|been registered)/i.test(msg)
      if (!exists) {
        return { ok: false, reason: 'invite_failed', message: msg }
      }
    } else if (invited?.user) {
      userId = invited.user.id
      created = true
    }
  } catch (err) {
    return { ok: false, reason: 'invite_failed', message: err instanceof Error ? err.message : String(err) }
  }

  if (!userId) {
    // Look up the existing user by email so we can target their profile row.
    try {
      const list = await (sb.auth as any).admin.listUsers({ page: 1, perPage: 200 })
      const found = list?.data?.users?.find((u: any) => u.email?.toLowerCase() === renter.email!.toLowerCase())
      if (found) userId = found.id
    } catch {/* ignore — we'll skip the profile upsert below */}
  }

  if (!userId) {
    // Couldn't reach the auth user (maybe a transient error) — invite still
    // went out; the user will land in the app and we'll create the profile
    // via the consumer app's own flow on first login.
    return { ok: true, created, userId: '' }
  }

  // 2) Mirror what we know into krayot_profiles. The column set on the
  //    consumer side is a superset of ours, so we map what overlaps.
  const profile = {
    id: userId,
    email: renter.email,
    first_name: renter.first_name,
    last_name:  renter.last_name,
    full_name:  fullName,
    phone:      renter.phone,
    role:       'renter',
    budget_min: renter.budget_min,
    budget_max: renter.budget_max,
    preferred_cities: renter.preferred_cities ?? [],
    preferred_rooms:  renter.preferred_rooms,
    pets:     renter.has_pets,
    smokers:  renter.smokers,
    move_in_from: renter.move_in_date,
    household_type:   renter.household_type,
    household_size:   renter.household_size,
    has_children:     renter.has_children,
    children_count:   renter.children_count,
    employment_status: renter.employment_status,
    employer:          renter.employer,
    monthly_income:    renter.monthly_income,
    has_payslips:        renter.has_payslips,
    has_security_checks: renter.has_security_checks,
    has_guarantors:      renter.has_guarantors,
    advanced_preferences: renter.preferences ?? {},
    match_weights:        renter.match_weights ?? null,
    metadata: {
      source: 'rent360_questionnaire',
      rent360_renter_id: renter.id,
      notes: renter.notes,
    },
    onboarding_completed: true,
    updated_at: new Date().toISOString(),
  }

  const { error: pErr } = await sb
    .from('krayot_profiles')
    .upsert(profile as any, { onConflict: 'id' })

  if (pErr) {
    return { ok: false, reason: 'profile_failed', message: pErr.message }
  }

  return { ok: true, created, userId }
}

/** Fire-and-forget wrapper for the submit endpoint. Logs failures, doesn't throw. */
export function enrollInBackground(renterId: string): void {
  enrollRenterInKrayotRental(renterId)
    .then(res => {
      if (!res.ok) {
        console.error(`[krayot-enroll:${renterId}] failed: ${res.reason}${res.message ? ' — ' + res.message : ''}`)
      }
    })
    .catch(err => {
      console.error(`[krayot-enroll:${renterId}] threw: ${err instanceof Error ? err.message : String(err)}`)
    })
}
