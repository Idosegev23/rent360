/**
 * Telegram admin alerts.
 *
 * Used when the AI conversation agent triggers a handoff, a closed_won, or
 * an inbound message arrives after business hours. The alert lands in the
 * admin's personal chat with the rent360 Telegram bot, and a sibling row
 * is written to `conversation_alerts` so the dashboard inbox shows the same.
 *
 * Env: TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID
 */

const TG_API_BASE = 'https://api.telegram.org'

export type AlertType = 'handoff' | 'inbound_after_hours' | 'closed_won' | 'urgent' | 'new_lead'

export type AlertContext = {
  threadId: string
  type: AlertType
  landlordName?: string | null
  landlordPhone?: string | null
  propertyTitle?: string | null
  propertyId?: string | null
  reason?: string
  urgency?: 'low' | 'medium' | 'high'
  dashboardUrl?: string
  /** Free-form context the AI wants the human to see. */
  notes?: string
}

const TYPE_EMOJI: Record<AlertType, string> = {
  handoff: '🤝',
  inbound_after_hours: '🌙',
  closed_won: '🎉',
  urgent: '🚨',
  new_lead: '✨',
}

const TYPE_TITLE_HE: Record<AlertType, string> = {
  handoff: 'בקשת מעבר לאדם',
  inbound_after_hours: 'הודעה אחרי שעות פעילות',
  closed_won: 'נכס נרשם בהצלחה',
  urgent: 'התראה דחופה',
  new_lead: 'ליד חדש',
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatBody(ctx: AlertContext): string {
  const parts: string[] = []
  parts.push(`${TYPE_EMOJI[ctx.type]} <b>${TYPE_TITLE_HE[ctx.type]}</b>`)
  if (ctx.urgency === 'high') parts.push('דחיפות: גבוהה ⚠️')
  if (ctx.landlordName || ctx.landlordPhone) {
    const who = [ctx.landlordName, ctx.landlordPhone].filter(Boolean).join(' · ')
    parts.push(`👤 ${escapeHtml(who)}`)
  }
  if (ctx.propertyTitle) parts.push(`🏠 ${escapeHtml(ctx.propertyTitle)}`)
  if (ctx.reason) parts.push(`📝 ${escapeHtml(ctx.reason)}`)
  if (ctx.notes) parts.push(`\n${escapeHtml(ctx.notes)}`)
  if (ctx.dashboardUrl) parts.push(`\n👉 <a href="${ctx.dashboardUrl}">פתח שיחה בדשבורד</a>`)
  return parts.join('\n')
}

export async function sendTelegramAlert(ctx: AlertContext): Promise<{ sent: boolean; reason?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID
  if (!token || !chatId) return { sent: false, reason: 'telegram_env_missing' }

  try {
    const res = await fetch(`${TG_API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatBody(ctx),
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      return { sent: false, reason: `telegram_${res.status}: ${err.slice(0, 200)}` }
    }
    return { sent: true }
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
