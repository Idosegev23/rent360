import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseService } from '../../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../../lib/auth'
import { embedInBackground, embedPropertyIfChanged } from '../../../../../../lib/ai/embeddings'
import { generatePersonalizationInBackground } from '../../../../../../lib/ai/property-vision'
import { computeMatchesInBackground } from '../../../../../../lib/matching/orchestrator'
import { normalizePropertyData } from '../../../../../../lib/data/normalize-property'

// Approval status for this property (so the property page can show "מאשר תיווך" vs "מאושר").
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })

  const { data: ap } = await sb
    .from('approved_properties')
    .select('approved_at, approval_method, approval_summary, conversation_transcript, approved_by, irrelevant_at, irrelevant_reason, recheck_at')
    .eq('org_id', user.org_id)
    .eq('property_id', params.id)
    .maybeSingle()
  if (!ap) return NextResponse.json({ approved: false })

  let approvedByName: string | null = null
  if (ap.approved_by) {
    const { data: u } = await sb.from('users').select('name').eq('id', ap.approved_by).maybeSingle()
    approvedByName = u?.name ?? null
  }
  return NextResponse.json({ approved: true, ...ap, approved_by_name: approvedByName })
}

// Mark an approved property "irrelevant" (e.g. rented NOT via us): it leaves the main approved
// list, moves to the irrelevant list, and gets a ~1-year recheck reminder. { irrelevant:false } reverts.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })

  let body: { irrelevant?: unknown; reason?: unknown } = {}
  try { body = await req.json() } catch {/* empty */}
  const markIrrelevant = body.irrelevant !== false // default to marking irrelevant
  const reason = String(body.reason || '').slice(0, 300) || null

  const { data: ap } = await sb.from('approved_properties').select('id').eq('org_id', user.org_id).eq('property_id', params.id).maybeSingle()
  if (!ap) return NextResponse.json({ error: { code: 'NOT_APPROVED', message: 'הנכס אינו ברשימת המאושרים' } }, { status: 404 })

  if (markIrrelevant) {
    const now = new Date()
    const recheck = new Date(now.getTime())
    recheck.setFullYear(recheck.getFullYear() + 1)
    const recheckDate = recheck.toISOString().slice(0, 10)
    const { error } = await sb.from('approved_properties').update({
      irrelevant_at: now.toISOString(), irrelevant_reason: reason, recheck_at: recheckDate, recheck_reminded_at: null,
    }).eq('id', ap.id)
    if (error) return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: error.message } }, { status: 500 })
    // Purge this property's renter matches so it disappears from the send lists + auto-dispatch
    // immediately. (property_shares.match_id FK is ON DELETE SET NULL; matches regenerate if the
    // property is later un-marked relevant — see below.)
    await sb.from('matches').delete().eq('org_id', user.org_id).eq('property_id', params.id)
    return NextResponse.json({ ok: true, status: 'irrelevant', recheck_at: recheckDate })
  }
  const { error } = await sb.from('approved_properties').update({
    irrelevant_at: null, irrelevant_reason: null, recheck_at: null, recheck_reminded_at: null,
  }).eq('id', ap.id)
  if (error) return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: error.message } }, { status: 500 })
  // Relevant again → rebuild its matches in the background.
  computeMatchesInBackground({ propertyId: params.id })
  return NextResponse.json({ ok: true, status: 'relevant' })
}

// Manual approval flow: agent confirms brokerage with the owner over the phone
// and clicks "אשר תיווך" — adds the property to approved_properties with approval_method='manual'.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })

  const orgId = user.org_id
  const propertyId = params.id

  // Approval REQUIRES: how viewings are coordinated + which agent owns the property.
  let body: { scheduling_mode?: unknown; assigned_agent_user_id?: unknown } = {}
  try { body = await req.json() } catch {/* empty */}
  const schedulingMode = String(body.scheduling_mode || '')
  const agentId = body.assigned_agent_user_id ? String(body.assigned_agent_user_id) : ''
  if (schedulingMode !== 'self_access' && schedulingMode !== 'requires_owner') {
    return NextResponse.json({ error: { code: 'SCHEDULING_MODE_REQUIRED', message: 'בחרו מצב תיאום פגישות (גישה עצמאית / מצריך בעל נכס)' } }, { status: 400 })
  }
  if (!agentId) {
    return NextResponse.json({ error: { code: 'AGENT_REQUIRED', message: 'יש לשייך את הנכס לסוכן' } }, { status: 400 })
  }
  const { data: agent } = await sb.from('users').select('id, is_active, handles_properties').eq('id', agentId).eq('org_id', orgId).maybeSingle()
  if (!agent || agent.is_active === false || !agent.handles_properties) {
    return NextResponse.json({ error: { code: 'BAD_AGENT', message: 'סוכן לא תקין' } }, { status: 400 })
  }

  const { data: property } = await sb
    .from('properties')
    .select('id, city, neighborhood, street, floor')
    .eq('id', propertyId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!property) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })

  // Persist the scheduling mode + agent assignment on the property.
  await sb.from('properties').update({ scheduling_mode: schedulingMode, assigned_agent_user_id: agentId }).eq('id', propertyId).eq('org_id', orgId)

  // Clean up scraper artifacts before the match engine sees it:
  // "חיפה - מגורים" → "חיפה", and split the concatenated
  // "<street> <num> קומה <n> <nbh>" string back into separate fields.
  // Only writes when the normalizer actually changed something.
  const normalized = normalizePropertyData({
    city: property.city,
    neighborhood: property.neighborhood,
    street: property.street,
    floor: property.floor,
  })
  const drift =
    normalized.city !== property.city ||
    normalized.neighborhood !== property.neighborhood ||
    normalized.street !== property.street ||
    normalized.floor !== property.floor
  if (drift) {
    await sb.from('properties').update(normalized).eq('id', propertyId)
  }

  const { data: existing } = await sb
    .from('approved_properties')
    .select('id, approved_at')
    .eq('org_id', orgId)
    .eq('property_id', propertyId)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ ok: true, status: 'already_approved', approval: existing })
  }

  const { data: inserted, error } = await sb
    .from('approved_properties')
    .insert({ org_id: orgId, property_id: propertyId, approved_by: userId, approval_method: 'manual' })
    .select('id, approved_at, approval_method')
    .single()
  if (error) {
    return NextResponse.json({ error: { code: 'INSERT_FAILED', message: error.message } }, { status: 500 })
  }

  // Approval triggers three side-effects, all fire-and-forget:
  //  1. RAG embedding — for `search_property_context` in the bot.
  //  2. Personalization line for outreach templates ({{4}} in landlord_outreach_v2_rich).
  //  3. Renter↔property matches — every renter scored against this new property.
  embedInBackground(() => embedPropertyIfChanged(propertyId), `approve:${propertyId}`)
  generatePersonalizationInBackground(propertyId)
  computeMatchesInBackground({ propertyId })

  return NextResponse.json({ ok: true, status: 'approved', approval: inserted })
}

// Soft-delete an approved property: remove the approved_properties row and mark
// the underlying property as inactive. Property + Storage images are preserved
// so the change is reversible (re-approve will recreate the row; setting
// is_active=true revives it on /properties).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })

  const orgId = user.org_id
  const propertyId = params.id

  const { data: property } = await sb
    .from('properties')
    .select('id')
    .eq('id', propertyId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!property) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })

  const { error: delErr } = await sb
    .from('approved_properties')
    .delete()
    .eq('org_id', orgId)
    .eq('property_id', propertyId)
  if (delErr) {
    return NextResponse.json({ error: { code: 'DELETE_FAILED', message: delErr.message } }, { status: 500 })
  }

  // Soft-delete: mark inactive AND clear the embedding so this property
  // disappears from the RAG index. Re-approving regenerates the embedding.
  const { error: updErr } = await sb
    .from('properties')
    .update({ is_active: false, embedding: null, embedding_source_hash: null })
    .eq('id', propertyId)
    .eq('org_id', orgId)
  if (updErr) {
    return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: updErr.message } }, { status: 500 })
  }

  return NextResponse.json({ ok: true, status: 'soft_deleted' })
}
