import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { sendTelegramAlert } from '../../../../../lib/alerts/telegram'

/**
 * Daily cron: a deal was closed (tenancy created) but no contract was uploaded → nudge the broker.
 *
 * "Documented" = a `documents` row with kind='contract' on the deal's property / tenancy / renter
 * (contracts are uploaded on the property page's Documents tab). For each undocumented closed deal
 * within the window, create a HIGH-priority task assigned to the broker who closed it (`created_by`)
 * — so it shows on their dashboard/tasks — and record an activity marker on the tenancy to dedupe
 * (one reminder per deal). A single Telegram admin ping summarizes the run.
 *
 * No client-facing WhatsApp (so no send-window / Meta-template dependency): the reminder is an
 * in-app task + Telegram. Guards: only deals older than MIN_HOURS and newer than MAX_DAYS (so a
 * historical backlog isn't turned into a flood), capped at MAX_PER_RUN.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`. Allowlisted in middleware. GET ?dryRun=1 = plan only.
 */
export const maxDuration = 120

async function run(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })
  }
  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'
  const sb = supabaseService()

  const MIN_HOURS = Number(process.env.DEAL_DOC_REMINDER_MIN_HOURS || 24)
  const MAX_DAYS = Number(process.env.DEAL_DOC_REMINDER_MAX_DAYS || 14)
  const MAX_PER_RUN = Number(process.env.DEAL_DOC_REMINDER_MAX_PER_RUN || 20)

  const now = Date.now()
  const olderThan = new Date(now - MIN_HOURS * 3600 * 1000).toISOString()
  const notOlderThan = new Date(now - MAX_DAYS * 24 * 3600 * 1000).toISOString()

  const { data: tenancies } = await sb
    .from('tenancies')
    .select('id, org_id, property_id, renter_id, created_by, created_at')
    .eq('status', 'active')
    .lte('created_at', olderThan)
    .gte('created_at', notOlderThan)
    .order('created_at', { ascending: true })
    .limit(500)
  const list = tenancies || []
  if (list.length === 0) return NextResponse.json({ ok: true, dryRun, scanned: 0, reminded: 0, plans: [] })

  const tenancyIds = list.map(t => t.id)
  const propIds = [...new Set(list.map(t => t.property_id).filter(Boolean))] as string[]
  const renterIds = [...new Set(list.map(t => t.renter_id).filter(Boolean))] as string[]

  async function docSet(entityType: string, ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set()
    const { data } = await sb.from('documents').select('entity_id').eq('kind', 'contract').eq('entity_type', entityType).in('entity_id', ids)
    return new Set((data || []).map(d => d.entity_id as string))
  }
  const [propDocs, tenDocs, renDocs] = await Promise.all([docSet('property', propIds), docSet('tenancy', tenancyIds), docSet('renter', renterIds)])

  // Already-reminded deals (dedupe marker on the tenancy).
  const { data: markers } = await sb
    .from('activity')
    .select('entity_id')
    .eq('entity_type', 'tenancy').eq('kind', 'note').eq('metadata->>deal_doc_reminder', 'true')
    .in('entity_id', tenancyIds)
  const alreadyReminded = new Set((markers || []).map(m => m.entity_id as string))

  const { data: props } = propIds.length
    ? await sb.from('properties').select('id, title, street, city').in('id', propIds)
    : { data: [] as any[] }
  const propById = new Map((props || []).map(p => [p.id, p]))

  type Plan = { tenancyId: string; orgId: string; propertyId: string | null; label: string; assignee: string | null; closedAt: string }
  const plans: Plan[] = []
  for (const t of list) {
    if (alreadyReminded.has(t.id)) continue
    const documented = (t.property_id && propDocs.has(t.property_id)) || tenDocs.has(t.id) || (t.renter_id && renDocs.has(t.renter_id))
    if (documented) continue
    const p = t.property_id ? propById.get(t.property_id) : null
    const label = p ? ([p.street, p.city].filter(Boolean).join(', ') || p.title || 'נכס') : 'נכס'
    plans.push({ tenancyId: t.id, orgId: t.org_id, propertyId: t.property_id, label, assignee: t.created_by, closedAt: t.created_at })
    if (plans.length >= MAX_PER_RUN) break
  }

  if (dryRun) return NextResponse.json({ ok: true, dryRun: true, scanned: list.length, candidates: plans.length, plans })

  let reminded = 0
  const errors: Array<{ tenancyId: string; error: string }> = []
  for (const pl of plans) {
    try {
      const closedLabel = new Date(pl.closedAt).toLocaleDateString('he-IL')
      await sb.from('tasks').insert({
        org_id: pl.orgId,
        title: `⚠️ חסר חוזה בעסקה — ${pl.label}`.slice(0, 200),
        notes: `העסקה נסגרה ב-${closedLabel} ללא חוזה. נא להעלות חוזה שכירות במסך הנכס (טאב מסמכים).`,
        assignee_user_id: pl.assignee || null,
        created_by: null,
        status: 'open',
        priority: 'high',
        entity_type: pl.propertyId ? 'property' : 'tenancy',
        entity_id: pl.propertyId || pl.tenancyId,
      })
      await sb.from('activity').insert({
        org_id: pl.orgId, entity_type: 'tenancy', entity_id: pl.tenancyId, author_user_id: null,
        kind: 'note', body: 'תזכורת: העסקה נסגרה ללא חוזה — נוצרה משימה למתווך.',
        metadata: { deal_doc_reminder: true },
      })
      reminded++
    } catch (err) {
      errors.push({ tenancyId: pl.tenancyId, error: err instanceof Error ? err.message : String(err) })
    }
  }

  if (reminded > 0) {
    try {
      await sendTelegramAlert({
        threadId: '', type: 'urgent',
        reason: `${reminded} עסקאות נסגרו ללא חוזה — נוצרו משימות תזכורת למתווכים`,
      })
    } catch {/* best-effort */}
  }

  return NextResponse.json({ ok: true, dryRun: false, scanned: list.length, reminded, ...(errors.length ? { errors } : {}) })
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
