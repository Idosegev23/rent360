import { NextRequest, NextResponse } from 'next/server'
import { requireOrg, requireCapability } from '../../../../lib/api/org-context'
import { DEFAULT_TOPICS } from '../../../../lib/ai/renter-interview/topics'

/**
 * Admin CRUD for the renter-interview topic list (the editable "מה-לאסוף" section).
 * GET → the org's topics, or the code DEFAULT_TOPICS (saved:false) if none are stored yet.
 * PUT → replace the org's topics with the posted array (upsert by key, delete removed keys).
 * The bot reads these via getEnabledTopics(); DEFAULT_TOPICS remains the fallback, so a bad
 * save can never leave the bot with no questions.
 */
export async function GET() {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { data, error } = await ctx.sb
    .from('interview_topics')
    .select('id, key, title, body_text, sort_order, enabled')
    .eq('org_id', ctx.orgId)
    .order('sort_order', { ascending: true })
  if (error) return NextResponse.json({ error: { code: 'QUERY_FAILED', message: error.message } }, { status: 500 })
  if (!data || data.length === 0) {
    const topics = DEFAULT_TOPICS.map((t, i) => ({ ...t, sort_order: i + 1, enabled: true }))
    return NextResponse.json({ topics, saved: false })
  }
  return NextResponse.json({ topics: data, saved: true })
}

export async function PUT(req: NextRequest) {
  const guard = await requireCapability('settings.admin')
  if ('res' in guard) return guard.res
  const ctx = guard.ctx
  const bad = (message: string) => NextResponse.json({ error: { code: 'BAD_REQUEST', message } }, { status: 400 })

  let body: Record<string, any> = {}
  try { body = await req.json() } catch {/* empty */}
  const input = Array.isArray(body.topics) ? body.topics : null
  if (!input) return bad('topics array required')
  if (input.length === 0) return bad('at least one topic required')

  const seen = new Set<string>()
  const rows: Array<Record<string, unknown>> = []
  for (let i = 0; i < input.length; i++) {
    const t = input[i] || {}
    const key = String(t.key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
    const title = String(t.title || '').trim().slice(0, 120)
    const body_text = String(t.body_text || '').trim().slice(0, 2000)
    if (!key) return bad(`topic ${i + 1}: key is required (a-z0-9_)`)
    if (!title) return bad(`topic ${i + 1}: title is required`)
    if (!body_text) return bad(`topic ${i + 1}: body_text is required`)
    if (seen.has(key)) return bad(`duplicate key: ${key}`)
    seen.add(key)
    rows.push({
      org_id: ctx.orgId, key, title, body_text,
      sort_order: i + 1, enabled: t.enabled !== false, updated_at: new Date().toISOString(),
    })
  }

  const { error: upErr } = await ctx.sb.from('interview_topics').upsert(rows, { onConflict: 'org_id,key' })
  if (upErr) return NextResponse.json({ error: { code: 'UPSERT_FAILED', message: upErr.message } }, { status: 500 })

  // Delete any topics the admin removed (keys no longer present). Keys are slugified, so the list
  // is safe to interpolate into the PostgREST `in` filter.
  const keys = [...seen]
  await ctx.sb.from('interview_topics').delete().eq('org_id', ctx.orgId).not('key', 'in', `(${keys.join(',')})`)

  const { data } = await ctx.sb
    .from('interview_topics')
    .select('id, key, title, body_text, sort_order, enabled')
    .eq('org_id', ctx.orgId)
    .order('sort_order', { ascending: true })
  return NextResponse.json({ ok: true, topics: data || [], saved: true })
}
