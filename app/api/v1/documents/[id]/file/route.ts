import { NextRequest, NextResponse } from 'next/server'
import { requireOrg } from '../../../../../../lib/api/org-context'

/** Serve a private uploaded document via a short-lived signed URL (302). Auth + org-scoped. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  const { data: doc } = await ctx.sb.from('documents').select('storage_path').eq('id', params.id).eq('org_id', ctx.orgId).maybeSingle()
  if (!doc?.storage_path) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })

  const signed = await ctx.sb.storage.from('deal-docs').createSignedUrl(doc.storage_path, 300)
  if (signed.error || !signed.data?.signedUrl) return NextResponse.json({ error: { code: 'SIGN_FAILED' } }, { status: 500 })
  return NextResponse.redirect(signed.data.signedUrl)
}
