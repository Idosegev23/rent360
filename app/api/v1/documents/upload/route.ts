import { NextRequest, NextResponse } from 'next/server'
import { requireOrg } from '../../../../../lib/api/org-context'

export const maxDuration = 60

const ALLOWED = ['property', 'renter', 'tenancy', 'thread']

/** Upload a file (contract / ID / payslip — sensitive) to the PRIVATE deal-docs bucket via the service
 *  role, and record a documents row with its storage_path. Served later through signed URLs only. */
export async function POST(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: { code: 'BAD_REQUEST' } }, { status: 400 }) }
  const file = form.get('file')
  const entityType = String(form.get('entity_type') || '')
  const entityId = String(form.get('entity_id') || '')
  const kind = String(form.get('kind') || '') || null
  if (!(file instanceof File)) return NextResponse.json({ error: { code: 'NO_FILE' } }, { status: 400 })
  if (!ALLOWED.includes(entityType) || !entityId) return NextResponse.json({ error: { code: 'BAD_ENTITY' } }, { status: 400 })
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: { code: 'TOO_LARGE', message: 'מקסימום 25MB' } }, { status: 413 })

  const safe = (file.name || 'file').replace(/[^\w.\-]+/g, '_').slice(-80)
  const stamp = `${entityId}-${safe}`.replace(/\s/g, '')
  const path = `${ctx.orgId}/${entityType}/${entityId}/${stamp}`
  const buf = Buffer.from(await file.arrayBuffer())

  const up = await ctx.sb.storage.from('deal-docs').upload(path, buf, {
    contentType: file.type || 'application/octet-stream', upsert: true,
  })
  if (up.error) return NextResponse.json({ error: { code: 'UPLOAD_FAILED', message: up.error.message } }, { status: 500 })

  const { data, error } = await ctx.sb.from('documents').insert({
    org_id: ctx.orgId, entity_type: entityType, entity_id: entityId,
    name: file.name || 'מסמך', url: `storage://deal-docs/${path}`, storage_path: path, kind, created_by: ctx.uid,
  }).select('id').single()
  if (error) return NextResponse.json({ error: { code: 'INSERT_FAILED', message: error.message } }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id })
}
