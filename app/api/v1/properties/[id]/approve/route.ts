import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseService } from '../../../../../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../../../../../lib/auth'

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

  const { data: property } = await sb
    .from('properties')
    .select('id')
    .eq('id', propertyId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!property) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })

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

  const { error: updErr } = await sb
    .from('properties')
    .update({ is_active: false })
    .eq('id', propertyId)
    .eq('org_id', orgId)
  if (updErr) {
    return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: updErr.message } }, { status: 500 })
  }

  return NextResponse.json({ ok: true, status: 'soft_deleted' })
}
