import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { requireAdminOrg } from '../../../../../lib/outreach/admin-context'
import { normalizePhone, isValidPhone } from '../../../../../lib/outreach/phone'

/**
 * Blocklist / opt-out list management for the Outreach Control Center.
 *
 *  - GET    → list suppression entries (optional `q` substring on phone).
 *  - POST   → bulk paste-import (`{ phones, reason? }`), normalized + deduped, source='manual'.
 *  - DELETE → remove one entry (`{ id }` or `{ phone }`).
 *
 * Auto opt-out (webhook button / stop-word / AI tool) already writes here via recordOptOut.
 */

export async function GET(req: NextRequest) {
  const ctx = await requireAdminOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const sb = supabaseService()

  const q = req.nextUrl.searchParams.get('q')?.trim()
  let query = sb
    .from('whatsapp_suppression')
    .select('id, phone, reason, source, created_at')
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .limit(1000)
  if (q) query = query.ilike('phone', `%${q}%`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })
  return NextResponse.json({ ok: true, rows: data || [], count: (data || []).length })
}

export async function POST(req: NextRequest) {
  const ctx = await requireAdminOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const sb = supabaseService()

  let body: { phones?: unknown; reason?: unknown } = {}
  try {
    body = await req.json()
  } catch {/* empty */}

  const raw = typeof body.phones === 'string'
    ? body.phones
    : Array.isArray(body.phones)
      ? body.phones.filter((x): x is string => typeof x === 'string').join('\n')
      : ''
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'ייבוא ידני'

  // Split on newlines / commas / semicolons / whitespace, normalize, validate, dedup.
  const tokens = raw.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
  let invalid = 0
  const normalized = new Set<string>()
  for (const t of tokens) {
    if (isValidPhone(t)) normalized.add(normalizePhone(t))
    else invalid++
  }
  if (normalized.size === 0) {
    return NextResponse.json({ ok: true, added: 0, duplicates: 0, invalid, total: tokens.length })
  }

  const candidates = Array.from(normalized)
  const { data: existing } = await sb
    .from('whatsapp_suppression')
    .select('phone')
    .eq('org_id', ctx.orgId)
    .in('phone', candidates)
  const have = new Set((existing || []).map(r => r.phone))
  const toInsert = candidates.filter(p => !have.has(p))

  if (toInsert.length > 0) {
    const { error } = await sb
      .from('whatsapp_suppression')
      .insert(toInsert.map(phone => ({ org_id: ctx.orgId, phone, reason, source: 'manual' })))
    if (error) return NextResponse.json({ error: { code: 'INSERT_FAILED', message: error.message } }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    added: toInsert.length,
    duplicates: candidates.length - toInsert.length,
    invalid,
    total: tokens.length,
  })
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireAdminOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const sb = supabaseService()

  let body: { id?: unknown; phone?: unknown } = {}
  try {
    body = await req.json()
  } catch {/* empty */}

  let del = sb.from('whatsapp_suppression').delete().eq('org_id', ctx.orgId)
  if (typeof body.id === 'string') {
    del = del.eq('id', body.id)
  } else if (typeof body.phone === 'string') {
    del = del.eq('phone', normalizePhone(body.phone))
  } else {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'id or phone required' } }, { status: 400 })
  }

  const { error } = await del
  if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })
  return NextResponse.json({ ok: true })
}
