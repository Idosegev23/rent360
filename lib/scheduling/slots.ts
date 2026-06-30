/**
 * Pure slot suggestion for the viewing scheduler (no I/O — unit-reasonable).
 *
 * Given the agent's BUSY intervals (from Google free/busy) + constraints, produce up to N candidate
 * viewing slots, spread across days, that are:
 *   - in the look-ahead window starting at `from`,
 *   - within business hours (Israel local),
 *   - not on Shabbat / Friday-evening (default `isBlockedDate`; holidays layered in by the caller),
 *   - inside an owner availability window for that weekday (when `ownerWindows` is given),
 *   - free of any overlap with the agent's busy intervals.
 *
 * All wall-clock reasoning is done in Israel time via Intl, so DST is handled correctly.
 */

const DEFAULT_TZ = 'Asia/Jerusalem'

export type BusyInterval = { start: string; end: string } // ISO timestamps
export type Slot = { start: Date; end: Date }
/** Owner availability window: weekday (0=Sun..6=Sat) + minutes-from-midnight range, Israel local. */
export type OwnerWindow = { dow: number; startMin: number; endMin: number }

export type SuggestOptions = {
  busy: BusyInterval[]
  from: Date
  lookaheadDays: number
  durationMin: number
  dayStartHour: number
  dayEndHour: number
  count: number
  stepMin?: number
  ownerWindows?: OwnerWindow[]
  isBlockedDate?: (localDow: number, localMinutes: number) => boolean
  tz?: string
}

type LocalParts = { dateKey: string; dow: number; minutes: number }

function localParts(d: Date, tz: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const p: Record<string, string> = {}
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const hour = parseInt(p.hour || '0', 10) % 24
  const minute = parseInt(p.minute || '0', 10)
  return {
    dateKey: `${p.year}-${p.month}-${p.day}`,
    dow: dowMap[p.weekday || 'Sun'] ?? 0,
    minutes: hour * 60 + minute,
  }
}

/** Default Shabbat guard: all of Saturday, and Friday from 14:00. */
function defaultIsBlocked(dow: number, minutes: number): boolean {
  if (dow === 6) return true               // Saturday
  if (dow === 5 && minutes >= 14 * 60) return true // Friday afternoon/eve
  return false
}

function overlapsBusy(startMs: number, endMs: number, busy: Array<{ s: number; e: number }>): boolean {
  for (const b of busy) {
    if (startMs < b.e && endMs > b.s) return true
  }
  return false
}

export function suggestSlots(opts: SuggestOptions): Slot[] {
  const tz = opts.tz || DEFAULT_TZ
  const step = Math.max(5, opts.stepMin || 30)
  const durMs = opts.durationMin * 60_000
  const isBlocked = opts.isBlockedDate || defaultIsBlocked
  const busy = opts.busy
    .map(b => ({ s: Date.parse(b.start), e: Date.parse(b.end) }))
    .filter(b => Number.isFinite(b.s) && Number.isFinite(b.e))

  // Round `from` up to the next step boundary so proposed times look clean.
  const startMs0 = Math.ceil(opts.from.getTime() / (step * 60_000)) * (step * 60_000)
  const horizonMs = opts.from.getTime() + opts.lookaheadDays * 24 * 60 * 60_000

  // Collect free slots, grouped by local date, in chronological order.
  const byDate = new Map<string, Slot[]>()
  for (let ms = startMs0; ms + durMs <= horizonMs; ms += step * 60_000) {
    const start = new Date(ms)
    const lp = localParts(start, tz)
    if (isBlocked(lp.dow, lp.minutes)) continue
    // Business hours: the whole slot must fit inside [dayStartHour, dayEndHour].
    if (lp.minutes < opts.dayStartHour * 60) continue
    if (lp.minutes + opts.durationMin > opts.dayEndHour * 60) continue
    // Owner availability (if provided): the slot must fall inside a window for this weekday.
    if (opts.ownerWindows && opts.ownerWindows.length) {
      const ok = opts.ownerWindows.some(w => w.dow === lp.dow && lp.minutes >= w.startMin && lp.minutes + opts.durationMin <= w.endMin)
      if (!ok) continue
    }
    if (overlapsBusy(ms, ms + durMs, busy)) continue
    const slot: Slot = { start, end: new Date(ms + durMs) }
    const arr = byDate.get(lp.dateKey)
    if (arr) arr.push(slot); else byDate.set(lp.dateKey, [slot])
  }

  // Spread: take the earliest free slot from each distinct day first, then fill from remaining.
  const dates = Array.from(byDate.keys()) // insertion order = chronological
  const out: Slot[] = []
  for (const d of dates) {
    if (out.length >= opts.count) break
    const arr = byDate.get(d)!
    if (arr[0]) out.push(arr[0])
  }
  if (out.length < opts.count) {
    for (const d of dates) {
      const arr = byDate.get(d)!
      for (let i = 1; i < arr.length && out.length < opts.count; i++) out.push(arr[i]!)
      if (out.length >= opts.count) break
    }
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime())
  return out.slice(0, opts.count)
}
