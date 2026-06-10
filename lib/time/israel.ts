/** Israel wall-clock helpers (DST-safe via the offset trick). Shared by tasks + meeting reminders. */

/** Parse an Israel wall-clock string ("YYYY-MM-DD" or "YYYY-MM-DDTHH:MM") into a UTC Date. */
export function israelLocalToUTC(local: string): Date {
  const [datePart = '', timePart = '00:00'] = local.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm] = timePart.split(':').map(Number)
  const guess = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1, hh || 0, mm || 0))
  const back = new Date(guess.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }))
  return new Date(guess.getTime() + (guess.getTime() - back.getTime()))
}

/** Today's date in Israel as "YYYY-MM-DD". */
export function israelToday(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }).slice(0, 10)
}

/** UTC bounds of an Israel calendar day (defaults to today). */
export function israelDayRangeUTC(dayStr: string = israelToday()): { startUTC: Date; endUTC: Date } {
  return { startUTC: israelLocalToUTC(`${dayStr}T00:00`), endUTC: israelLocalToUTC(`${dayStr}T23:59`) }
}
