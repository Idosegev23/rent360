import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { israelToday, israelLocalToUTC } from '../../../../../lib/time/israel'
import { getNumberHealth } from '../../../../../lib/whatsapp/number-health'
import { sendTelegramText } from '../../../../../lib/alerts/telegram'

/**
 * Monthly cron (1st of the month, 10:00 Israel): WhatsApp number health report to the admin Telegram.
 *
 * Reads the number's quality rating + messaging tier from Meta and last month's renewal outreach
 * numbers — sent, not delivered (and how many of those Meta refused with 131049), opt-outs. The
 * quality rating is what automatic sends put at risk, so a non-GREEN rating is flagged with the
 * switch that stops them. Read-only apart from the Telegram message; internal alert, so not gated
 * by the send window. GET ?dryRun=1 returns the report without sending it.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`. Allowlisted in middleware.
 */
export const maxDuration = 60

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The previous Israel calendar month as UTC bounds plus an "MM/YYYY" label. */
function previousMonth(): { startIso: string; endIso: string; label: string } {
  const [y = 1970, m = 1] = israelToday().split('-').map(Number)
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    startIso: israelLocalToUTC(`${py}-${pad(pm)}-01T00:00`).toISOString(),
    endIso: israelLocalToUTC(`${y}-${pad(m)}-01T00:00`).toISOString(),
    label: `${pad(pm)}/${py}`,
  }
}

const QUALITY_ICON: Record<string, string> = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴' }

async function run(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })
  }
  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'
  const sb = supabaseService()
  const { startIso, endIso, label } = previousMonth()

  const health = await getNumberHealth()

  const renewalFailed = () => sb
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('direction', 'out')
    .eq('status', 'failed')
    .like('template_name', 'landlord_renewal%')
    .gte('created_at', startIso)
    .lt('created_at', endIso)

  const [sentRes, failedRes, refusedRes, optOutRes] = await Promise.all([
    sb.from('renewal_leads').select('id', { count: 'exact', head: true })
      .eq('status', 'sent').gte('sent_at', startIso).lt('sent_at', endIso),
    renewalFailed(),
    renewalFailed().eq('metadata->errors->0->>code', '131049'),
    sb.from('whatsapp_suppression').select('id', { count: 'exact', head: true })
      .gte('created_at', startIso).lt('created_at', endIso),
  ])
  const firstError = [sentRes, failedRes, refusedRes, optOutRes].find(r => r.error)?.error
  if (firstError) return NextResponse.json({ error: { code: 'DB_ERROR', message: firstError.message } }, { status: 500 })

  const sent = sentRes.count || 0
  const failed = failedRes.count || 0
  const pct = (n: number) => (sent > 0 ? ` (${Math.round((n / sent) * 100)}%)` : '')

  const lines: string[] = [`📊 <b>דוח חודשי: מספר הוואטסאפ מול Meta</b>`, `חודש: ${label}`, '']
  if (health.ok) {
    const quality = health.quality || 'לא ידוע'
    lines.push(
      `📱 ${escapeHtml(health.displayPhone || '')}`,
      `דירוג איכות: ${QUALITY_ICON[quality] || '⚪️'} ${escapeHtml(quality)}`,
      `מכסה יומית: ${escapeHtml(health.tier || 'לא ידוע')}`,
      `סטטוס: ${escapeHtml(health.status || 'לא ידוע')}`,
    )
    if (health.quality !== 'GREEN') {
      lines.push('', '⚠️ הדירוג אינו ירוק. מומלץ לעצור את השליחה האוטומטית (RENEWAL_AUTOSEND_ENABLED=false) ולבדוק ב-WhatsApp Manager.')
    }
  } else {
    lines.push(`⚠️ לא ניתן היה לקרוא את נתוני המספר מ-Meta: ${escapeHtml(health.error)}`)
  }
  lines.push(
    '',
    `📨 פניות חידוש שנשלחו: ${sent}`,
    `❌ לא נמסרו: ${failed}${pct(failed)}, מתוכן ${refusedRes.count || 0} נחסמו ע״י Meta (131049)`,
    `🚫 בקשות הסרה: ${optOutRes.count || 0}${pct(optOutRes.count || 0)}`,
  )
  const text = lines.join('\n')

  if (dryRun) return NextResponse.json({ ok: true, dryRun, health, text })
  const tg = await sendTelegramText(text)
  return NextResponse.json({ ok: tg.sent, health, telegram: tg })
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
