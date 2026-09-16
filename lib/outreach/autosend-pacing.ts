/**
 * Pacing shared by the automatic outreach crons (renewal + landlord recruitment). Each cron runs every
 * AUTOSEND_RUN_EVERY_MIN minutes and sends an even share of what is left of its daily target, so a
 * day's sends trickle out until the send window closes instead of bursting when it opens.
 */

import { SEND_WINDOW_END_HOUR } from '../time/send-window'

export const AUTOSEND_RUN_EVERY_MIN = 15

export function israelMinutesOfDay(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: string): number => Number(parts.find(p => p.type === type)?.value || 0)
  return get('hour') * 60 + get('minute')
}

/** This run's even share of what is left today: remaining ÷ runs left before the window closes. */
export function runQuota(remaining: number, now: Date, maxPerRun: number): number {
  if (remaining <= 0) return 0
  const runsLeft = Math.max(1, Math.ceil((SEND_WINDOW_END_HOUR * 60 - israelMinutesOfDay(now)) / AUTOSEND_RUN_EVERY_MIN))
  return Math.min(maxPerRun, Math.round(remaining / runsLeft))
}
