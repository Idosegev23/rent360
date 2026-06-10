import { google } from 'googleapis'
import {
  getGoogleClientForUser,
  isGoogleAuthError,
  invalidateConnection,
  GoogleNotConnectedError,
} from '@/lib/google/client'

const DEFAULT_TZ = 'Asia/Jerusalem'

export async function createCalendarEvent(args: {
  orgId: string
  userId: string
  summary: string
  description?: string
  start: Date
  end: Date
  attendees?: string[]
  timeZone?: string
}): Promise<{ eventId: string; htmlLink: string }> {
  const auth = await getGoogleClientForUser(args.orgId, args.userId)
  const calendar = google.calendar({ version: 'v3', auth })
  const tz = args.timeZone || DEFAULT_TZ
  try {
    const res = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: args.summary,
        ...(args.description ? { description: args.description } : {}),
        start: { dateTime: args.start.toISOString(), timeZone: tz },
        end: { dateTime: args.end.toISOString(), timeZone: tz },
        ...(args.attendees ? { attendees: args.attendees.map((email) => ({ email })) } : {}),
      },
    })
    return { eventId: res.data.id!, htmlLink: res.data.htmlLink || '' }
  } catch (err) {
    if (isGoogleAuthError(err)) {
      await invalidateConnection(args.orgId, args.userId)
      throw new GoogleNotConnectedError()
    }
    throw err
  }
}

export async function cancelCalendarEvent(args: {
  orgId: string
  userId: string
  eventId: string
}): Promise<void> {
  const auth = await getGoogleClientForUser(args.orgId, args.userId)
  const calendar = google.calendar({ version: 'v3', auth })
  try {
    await calendar.events.delete({ calendarId: 'primary', eventId: args.eventId })
  } catch (err) {
    if (isGoogleAuthError(err)) {
      await invalidateConnection(args.orgId, args.userId)
      throw new GoogleNotConnectedError()
    }
    // 404/410 = already gone; treat as success.
    const status = (err as { code?: number; response?: { status?: number } })?.code ?? (err as { response?: { status?: number } })?.response?.status
    if (status === 404 || status === 410) return
    throw err
  }
}

export async function updateCalendarEvent(args: {
  orgId: string
  userId: string
  eventId: string
  summary?: string
  description?: string
  start?: Date
  end?: Date
  timeZone?: string
}): Promise<{ eventId: string }> {
  const auth = await getGoogleClientForUser(args.orgId, args.userId)
  const calendar = google.calendar({ version: 'v3', auth })
  const tz = args.timeZone || DEFAULT_TZ
  try {
    const res = await calendar.events.patch({
      calendarId: 'primary',
      eventId: args.eventId,
      requestBody: {
        ...(args.summary ? { summary: args.summary } : {}),
        ...(args.description ? { description: args.description } : {}),
        ...(args.start ? { start: { dateTime: args.start.toISOString(), timeZone: tz } } : {}),
        ...(args.end ? { end: { dateTime: args.end.toISOString(), timeZone: tz } } : {}),
      },
    })
    return { eventId: res.data.id! }
  } catch (err) {
    if (isGoogleAuthError(err)) {
      await invalidateConnection(args.orgId, args.userId)
      throw new GoogleNotConnectedError()
    }
    throw err
  }
}
