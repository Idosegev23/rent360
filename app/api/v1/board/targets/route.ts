import { NextRequest, NextResponse } from 'next/server'
import { requireOrg } from '../../../../../lib/api/org-context'

/** Upsert one agent's target for one month. `month` is always the 1st ('YYYY-MM-01'). */
export async function PUT(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { sb, orgId } = ctx

  let body: { userId?: unknown; month?: unknown; targetDeals?: unknown; targetCommission?: unknown } = {}
  try { body = await req.json() } catch { /* empty body */ }
  const userId = typeof body.userId === 'string' ? body.userId : ''
  const month = typeof body.month === 'string' && /^\d{4}-\d{2}-01$/.test(body.month) ? body.month : ''
  const deals = Number(body.targetDeals)
  const commission = Number(body.targetCommission)
  if (!userId || !month || !Number.isInteger(deals) || deals < 0 || !Number.isInteger(commission) || commission < 0) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'חסרים נתונים: סוכן, חודש (YYYY-MM-01) ומספרים שלמים, 0 ומעלה' } }, { status: 400 })
  }

  const { data: u } = await sb.from('users').select('id').eq('id', userId).eq('org_id', orgId).maybeSingle()
  if (!u) return NextResponse.json({ error: { code: 'BAD_USER', message: 'הסוכן לא נמצא' } }, { status: 400 })

  const { error } = await sb.from('agent_targets').upsert(
    { org_id: orgId, user_id: userId, month, target_deals: deals, target_commission: commission, updated_at: new Date().toISOString() },
    { onConflict: 'org_id,user_id,month' },
  )
  if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })
  return NextResponse.json({ ok: true })
}
