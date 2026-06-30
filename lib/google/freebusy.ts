import { google } from 'googleapis'
import { getGoogleClientForUser, isGoogleAuthError, invalidateConnection } from '@/lib/google/client'

const DEFAULT_TZ = 'Asia/Jerusalem'

export type BusyInterval = { start: string; end: string }

/**
 * Read busy intervals from a user's PRIMARY Google Calendar between [from, to].
 *
 * Requires the `calendar.readonly` (or full `calendar`) scope on the user's grant — agents who
 * connected before Phase 3 have only `calendar.events` (write) and must reconnect once. If the user
 * isn't connected, callers should treat that as "availability unknown" and fall back (don't crash).
 *
 * Used by the viewing scheduler to compute agent-free slots.
 */
export async function getCalendarBusy(
  orgId: string,
  userId: string,
  from: Date,
  to: Date,
  timeZone: string = DEFAULT_TZ,
): Promise<BusyInterval[]> {
  const auth = await getGoogleClientForUser(orgId, userId)
  const calendar = google.calendar({ version: 'v3', auth })
  try {
    const res = await calendar.freebusy.query({
      requestBody: {
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        timeZone,
        items: [{ id: 'primary' }],
      },
    })
    const primary = res.data.calendars?.['primary']
    const busy = primary?.busy || []
    return busy
      .filter((b): b is { start: string; end: string } => typeof b.start === 'string' && typeof b.end === 'string')
      .map(b => ({ start: b.start, end: b.end }))
  } catch (err) {
    if (isGoogleAuthError(err)) await invalidateConnection(orgId, userId).catch(() => {})
    throw err
  }
}
