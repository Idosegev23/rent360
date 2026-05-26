import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { computeMatchesInBackground } from '../../../../../lib/matching/orchestrator'

/**
 * Public endpoint — a renter submits the multi-step questionnaire from /r/[token].
 *
 * 1. Upserts the renter row keyed on phone.
 * 2. Bumps submissions_count.
 * 3. Appends an audit row to renter_submissions.
 * 4. Marks the invite as submitted.
 * 5. Optional webhook (RENTER_WEBHOOK_URL) for Make.com / Zapier hook.
 * 6. Fires computeMatchesForRenter in background → fresh matches against every
 *    approved property in every org.
 */

const WEBHOOK_URL = process.env.RENTER_WEBHOOK_URL || ''

function s(v: any): string | null {
  if (v === null || v === undefined) return null
  const str = String(v).trim()
  return str ? str : null
}
function toInt(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = parseInt(String(v), 10)
  return Number.isFinite(n) ? n : null
}
function toNum(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}
function toBool(v: any): boolean | null {
  if (v === true || v === false) return v
  return null
}
function toArray(v: any): string[] {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean)
  if (typeof v === 'string') return v.split(/[,\n]/).map(x => x.trim()).filter(Boolean)
  return []
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json()
    const invite_token = s(payload.invite_token)
    const first_name = s(payload.first_name)
    const last_name = s(payload.last_name)
    const phone = s(payload.phone)
    const email = s(payload.email)

    if (!first_name || !phone) {
      return NextResponse.json({ error: 'חסרים פרטי חובה (שם וטלפון)' }, { status: 400 })
    }

    const sb = supabaseService()

    const renterRow: Record<string, unknown> = {
      phone,
      first_name,
      last_name,
      email,
      last_invite_token: invite_token,
      updated_at: new Date().toISOString(),

      budget_min: toInt(payload.budget_min),
      budget_max: toInt(payload.budget_max),
      budget_flexibility: toInt(payload.budget_flexibility) ?? 0,
      vaad_bayit_max: toInt(payload.vaad_bayit_max),
      arnona_max: toInt(payload.arnona_max),
      contract_length: s(payload.contract_length),

      preferred_cities: toArray(payload.preferred_cities),
      preferred_neighborhoods: toArray(payload.preferred_neighborhoods),

      preferred_rooms: toNum(payload.preferred_rooms),
      rooms_flexible: toBool(payload.rooms_flexible) ?? false,
      min_sqm: toInt(payload.min_sqm),
      floor_min: toInt(payload.floor_min),
      floor_max: toInt(payload.floor_max),
      top_floor_preference: s(payload.top_floor_preference) ?? 'any',
      condition_preference: s(payload.condition_preference) ?? 'any',

      move_in_date: s(payload.move_in_date),
      move_in_flexible: toBool(payload.move_in_flexible),

      household_type: s(payload.household_type),
      household_size: toInt(payload.household_size),
      has_children: toBool(payload.has_children),
      children_count: toBool(payload.has_children) ? toInt(payload.children_count) : null,
      has_pets: toBool(payload.has_pets),
      smokers: toBool(payload.smokers),

      preferences: payload.preferences && typeof payload.preferences === 'object' ? payload.preferences : {},

      employment_status: s(payload.employment_status),
      employer: s(payload.employer),
      has_payslips: toBool(payload.has_payslips),
      has_security_checks: toBool(payload.has_security_checks),
      has_guarantors: toBool(payload.has_guarantors),

      notes: s(payload.notes),
    }

    // Upsert renter on phone
    const { data: upserted, error: upsertErr } = await sb
      .from('renters')
      .upsert(renterRow, { onConflict: 'phone' })
      .select('id, submissions_count')
      .single()
    if (upsertErr) {
      console.error('[renter submit] upsert failed:', upsertErr.message)
      return NextResponse.json({ error: 'שגיאה בשמירה' }, { status: 500 })
    }
    const renterId = upserted?.id || null

    // Bump submissions_count (best-effort)
    if (renterId) {
      sb.from('renters')
        .update({ submissions_count: (upserted.submissions_count ?? 0) + 1 })
        .eq('id', renterId)
        .then(() => {/* ignore */}, () => {/* ignore */})
    }

    // Append audit row
    const { data: subRows } = await sb.from('renter_submissions').insert({
      renter_id: renterId,
      invite_token,
      phone,
      first_name,
      last_name,
      snapshot: { ...renterRow, raw_payload: payload },
    }).select('id').single()
    const submissionId = subRows?.id || null

    // Mark invite submitted
    if (invite_token) {
      sb.from('renter_invites')
        .update({ status: 'submitted', submitted_at: new Date().toISOString() })
        .eq('token', invite_token)
        .then(() => {/* ignore */}, () => {/* ignore */})
    }

    // Optional webhook
    if (WEBHOOK_URL) {
      fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          renter_id: renterId,
          submission_id: submissionId,
          invite_token,
          ...renterRow,
          submitted_at: new Date().toISOString(),
        }),
      }).catch(() => {})
    }

    // Recompute renter↔property matches in background
    if (renterId) {
      computeMatchesInBackground({ renterId })
    }

    return NextResponse.json({
      success: true,
      renter_id: renterId,
      submission_id: submissionId,
    })
  } catch (err) {
    console.error('[renter submit] error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 })
  }
}
