import { NextResponse } from 'next/server'
import { requireOrg } from '@/lib/api/org-context'
import { getConnection } from '@/lib/google/connections'

export async function GET() {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const conn = await getConnection(ctx.orgId, ctx.uid)
  return NextResponse.json({
    connected: !!conn && conn.status === 'active',
    email: conn?.google_email ?? null,
    status: conn?.status ?? null,
    scopes: conn?.scopes ?? [],
  })
}
