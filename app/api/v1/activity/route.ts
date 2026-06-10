import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrg } from '@/lib/api/org-context'

/** Timeline for one entity (newest first), with author names resolved. */
export async function GET(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const q = new URL(req.url).searchParams
  const entityType = q.get('entity_type')
  const entityId = q.get('entity_id')
  if (!entityType || !entityId) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'entity_type + entity_id required' } }, { status: 400 })

  const { data, error } = await ctx.sb
    .from('activity')
    .select('id, kind, body, metadata, author_user_id, created_at')
    .eq('org_id', ctx.orgId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: { code: 'QUERY_FAILED', message: error.message } }, { status: 500 })

  const rows = data || []
  const authorIds = Array.from(new Set(rows.map((r) => r.author_user_id).filter(Boolean))) as string[]
  const names = new Map<string, string>()
  if (authorIds.length) {
    const { data: users } = await ctx.sb.from('users').select('id, name').in('id', authorIds)
    for (const u of users || []) names.set(u.id, u.name || '')
  }
  return NextResponse.json({
    activity: rows.map((r) => ({ ...r, author_name: r.author_user_id ? names.get(r.author_user_id) || null : null })),
  })
}

const Body = z.object({
  entity_type: z.enum(['property', 'renter', 'thread', 'tenancy', 'task', 'meeting', 'contact']),
  entity_id: z.string().uuid(),
  kind: z.enum(['note', 'call', 'whatsapp', 'email', 'status_change']).optional(),
  body: z.string().min(1),
})

export async function POST(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: parsed.error.message } }, { status: 400 })
  const b = parsed.data
  const { data, error } = await ctx.sb
    .from('activity')
    .insert({ org_id: ctx.orgId, entity_type: b.entity_type, entity_id: b.entity_id, author_user_id: ctx.uid, kind: b.kind || 'note', body: b.body })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: { code: 'INSERT_FAILED', message: error.message } }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id })
}
