/**
 * Outbound-send window guard. Outreach / reminder sends must NEVER go out:
 *  - at night / very early — only inside [START_HOUR, END_HOUR) Israel local, and
 *  - from Shabbat/Yom-Tov candle-lighting until havdalah (real times via Hebcal, Haifa).
 *
 * Used by the reminders cron and the renter-alert dispatcher. Conversational AI replies and
 * urgent human-handoff alerts are intentionally NOT gated here (they're reactive, not blasts).
 */

const START_HOUR = Number(process.env.SEND_WINDOW_START_HOUR || 9) // earliest send hour (Israel)
const END_HOUR = Number(process.env.SEND_WINDOW_END_HOUR || 21) // latest send hour (exclusive)
const GEONAMEID = process.env.HEBCAL_GEONAMEID || '294801' // Haifa, Israel

// Candle-lighting → havdalah windows (Shabbat + Yom Tov), cached ~12h. Each pair is a no-send window.
let _cache: { at: number; windows: Array<[number, number]> } | null = null

async function blockedWindows(nowMs: number): Promise<Array<[number, number]>> {
  if (_cache && nowMs - _cache.at < 12 * 60 * 60 * 1000) return _cache.windows
  try {
    // i=on → Israel holiday scheme; c=on → candle-lighting; M=on → havdalah; b=40 → 40min before sunset.
    const url = `https://www.hebcal.com/hebcal?v=1&cfg=json&year=now&i=on&c=on&M=on&b=40&geonameid=${GEONAMEID}`
    const r = await fetch(url)
    const j = (await r.json()) as { items?: Array<{ category: string; date: string }> }
    const evts = (j.items || []).filter((x) => x.category === 'candles' || x.category === 'havdalah')
    const windows: Array<[number, number]> = []
    let open: number | null = null
    for (const it of evts) {
      const t = new Date(it.date).getTime() // ISO with TZ offset → absolute instant
      if (it.category === 'candles') open = t
      else if (open != null) { windows.push([open, t]); open = null }
    }
    _cache = { at: nowMs, windows }
    return windows
  } catch {
    return _cache?.windows || [] // fail-open ONLY on network error; hour gate still applies
  }
}

function israelHour(now: Date): number {
  return Number(now.toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }).slice(11, 13))
}

export async function canSendNow(now: Date = new Date()): Promise<{ ok: boolean; reason?: string }> {
  const hour = israelHour(now)
  if (hour < START_HOUR) return { ok: false, reason: 'before_morning_window' }
  if (hour >= END_HOUR) return { ok: false, reason: 'evening_quiet' }
  const t = now.getTime()
  const windows = await blockedWindows(t)
  if (windows.some(([s, e]) => t >= s && t <= e)) return { ok: false, reason: 'shabbat_or_holiday' }
  return { ok: true }
}
