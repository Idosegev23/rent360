/**
 * Outbound-send window guard. Outreach / reminder sends must NEVER go out:
 *  - at night / very early — only inside [START_HOUR, END_HOUR) Israel local, and
 *  - from Shabbat/Yom-Tov candle-lighting until havdalah (real times via Hebcal, Haifa).
 *
 * Used by the reminders cron, the renter-alert dispatcher, and the renewal
 * outreach dispatcher. Conversational AI replies and urgent human-handoff
 * alerts are intentionally NOT gated here (they're reactive, not blasts).
 *
 * Shared file — this guard backs every one of those live send paths, so any
 * change here must only ever narrow (block more) an edge case, never widen
 * (permit something that previously would have been blocked). See the
 * cold-cache fallback below (fix round 1 of Task 7, 2026-09-01) for the one
 * outage-only case where behaviour intentionally changes.
 */

const START_HOUR = Number(process.env.SEND_WINDOW_START_HOUR || 9) // earliest send hour (Israel)
const END_HOUR = Number(process.env.SEND_WINDOW_END_HOUR || 21) // latest send hour (exclusive)
const GEONAMEID = process.env.HEBCAL_GEONAMEID || '294801' // Haifa, Israel

// Candle-lighting → havdalah windows (Shabbat + Yom Tov), cached ~12h. Each pair is a no-send window.
let _cache: { at: number; windows: Array<[number, number]> } | null = null

async function blockedWindows(nowMs: number): Promise<{ windows: Array<[number, number]>; fetchFailedCold: boolean }> {
  if (_cache && nowMs - _cache.at < 12 * 60 * 60 * 1000) return { windows: _cache.windows, fetchFailedCold: false }
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
    return { windows, fetchFailedCold: false }
  } catch {
    // Fail-open ONLY when a recent cache exists — the real windows are just
    // slightly stale, not absent, and the hour gate still applies regardless.
    if (_cache) return { windows: _cache.windows, fetchFailedCold: false }
    // COLD cache (first call after a deploy, or an outage lasting past the
    // 12h TTL): we have zero real Shabbat/Yom-Tov data. Signal this back to
    // canSendNow() so it can layer the conservative local approximation
    // below instead of silently allowing every send through.
    return { windows: [], fetchFailedCold: true }
  }
}

function israelHour(now: Date): number {
  return Number(now.toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }).slice(11, 13))
}

/**
 * Conservative LOCAL approximation of the Shabbat block — used ONLY when the
 * Hebcal fetch fails AND there is no cache to fall back on (cold-cache
 * outage). Blocks Friday 12:00 through Saturday 20:30, Israel local wall
 * clock, determined directly from `now`'s Israel-local weekday/hour/minute
 * (no epoch/DST arithmetic needed, so no reliance on getting Israel's
 * UTC+2/UTC+3 offset right).
 *
 * Real candle-lighting is never before ~15:30 and havdalah never after
 * ~20:15 across the year at this geoname, so this window is deliberately
 * wider on both ends — it may over-block by up to a couple of hours on some
 * weeks. That's the intended tradeoff against the one rule that must never
 * be violated, per the brief's blanket fail-closed instruction NOT to
 * apply: this still allows ordinary Sunday–Thursday and Friday-morning
 * sends during the same outage, it only widens the Friday/Saturday block.
 *
 * KNOWN RESIDUAL GAP — Yom Tov cannot be approximated this way (it moves on
 * the Hebrew calendar, independent of day-of-week) and remains UNCOVERED
 * during a cold-cache outage. A holiday falling on a Sunday–Thursday during
 * a prolonged Hebcal outage would not be blocked by this fallback. This is
 * a documented, accepted gap, not an oversight — closing it would require
 * either a bundled Hebrew-calendar computation or a second, independent
 * holiday-dates data source, both out of scope for this fix.
 */
function isConservativeShabbatWindow(now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: string): string => parts.find(p => p.type === type)?.value || ''
  const weekday = get('weekday') // 'Fri' | 'Sat' | ...
  const minutesOfDay = Number(get('hour')) * 60 + Number(get('minute'))
  if (weekday === 'Fri') return minutesOfDay >= 12 * 60 // from 12:00 Friday onward
  if (weekday === 'Sat') return minutesOfDay <= 20 * 60 + 30 // until 20:30 Saturday
  return false
}

export async function canSendNow(now: Date = new Date()): Promise<{ ok: boolean; reason?: string }> {
  const hour = israelHour(now)
  if (hour < START_HOUR) return { ok: false, reason: 'before_morning_window' }
  if (hour >= END_HOUR) return { ok: false, reason: 'evening_quiet' }
  const t = now.getTime()
  const { windows, fetchFailedCold } = await blockedWindows(t)
  if (windows.some(([s, e]) => t >= s && t <= e)) return { ok: false, reason: 'shabbat_or_holiday' }
  // Only reachable during a cold-cache Hebcal outage (see blockedWindows above) —
  // in every other case fetchFailedCold is false and this is a no-op, so normal
  // (non-outage) behaviour is unchanged.
  if (fetchFailedCold && isConservativeShabbatWindow(now)) {
    return { ok: false, reason: 'shabbat_or_holiday_fallback' }
  }
  return { ok: true }
}
