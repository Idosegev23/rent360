import { NextResponse } from 'next/server'
import { requireOrg } from '@/lib/api/org-context'
import { getConnection, deleteConnection } from '@/lib/google/connections'

export async function POST() {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const conn = await getConnection(ctx.orgId, ctx.uid)
  if (conn?.refresh_token) {
    await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(conn.refresh_token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).catch(() => {})
  }
  await deleteConnection(ctx.orgId, ctx.uid)
  return NextResponse.json({ ok: true })
}
