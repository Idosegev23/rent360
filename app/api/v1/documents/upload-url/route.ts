import { NextRequest, NextResponse } from 'next/server'
import { requireOrg } from '../../../../../lib/api/org-context'

const ALLOWED = ['property', 'renter', 'tenancy', 'thread']

/**
 * Issue a short-lived signed upload URL for the PRIVATE deal-docs bucket so the browser uploads the
 * file DIRECTLY to Supabase Storage — bypassing Vercel's ~4.5MB serverless request-body limit that
 * blocks larger contracts/scans/photos. The client then calls /api/v1/documents to record the row.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  let b: { entity_type?: string; entity_id?: string; filename?: string } = {}
  try { b = await req.json() } catch {/* empty */}
  const entityType = String(b.entity_type || '')
  const entityId = String(b.entity_id || '')
  if (!ALLOWED.includes(entityType) || !entityId) return NextResponse.json({ error: { code: 'BAD_ENTITY' } }, { status: 400 })

  const safe = (b.filename || 'file').replace(/[^\w.\-]+/g, '_').slice(-80)
  const path = `${ctx.orgId}/${entityType}/${entityId}/${Date.now()}-${safe}`.replace(/\s/g, '')

  const { data, error } = await ctx.sb.storage.from('deal-docs').createSignedUploadUrl(path)
  if (error || !data) return NextResponse.json({ error: { code: 'SIGN_FAILED', message: error?.message || 'failed' } }, { status: 500 })
  return NextResponse.json({ ok: true, path: data.path, token: data.token })
}
