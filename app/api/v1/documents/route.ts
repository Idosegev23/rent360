import { NextRequest, NextResponse } from 'next/server'
import { requireOrg } from '../../../../lib/api/org-context'

/** Link-based document vault per entity (broker agreement, ID, payslips, contract — usually Google
 *  Drive links). GET ?entity_type=&entity_id= → list; POST → add. */
export async function GET(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const q = new URL(req.url).searchParams
  const entityType = q.get('entity_type'); const entityId = q.get('entity_id')
  if (!entityType || !entityId) return NextResponse.json({ documents: [] })
  const { data } = await ctx.sb
    .from('documents').select('id, name, url, kind, storage_path, created_at')
    .eq('org_id', ctx.orgId).eq('entity_type', entityType).eq('entity_id', entityId)
    .order('created_at', { ascending: false })
  return NextResponse.json({ documents: data || [] })
}

export async function POST(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  let b: { entity_type?: string; entity_id?: string; name?: string; url?: string; kind?: string } = {}
  try { b = await req.json() } catch {/* empty */}
  const entityType = String(b.entity_type || ''); const entityId = String(b.entity_id || '')
  const name = String(b.name || '').trim(); let url = String(b.url || '').trim()
  if (!entityType || !entityId || !name || !url) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'entity + name + url required' } }, { status: 400 })
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  const { data, error } = await ctx.sb.from('documents').insert({
    org_id: ctx.orgId, entity_type: entityType, entity_id: entityId, name, url, kind: b.kind || null, created_by: ctx.uid,
  }).select('id').single()
  if (error) return NextResponse.json({ error: { code: 'INSERT_FAILED', message: error.message } }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id })
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: { code: 'BAD_REQUEST' } }, { status: 400 })
  await ctx.sb.from('documents').delete().eq('id', id).eq('org_id', ctx.orgId)
  return NextResponse.json({ ok: true })
}
