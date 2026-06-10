import { google } from 'googleapis'
import {
  getGoogleClientForUser,
  isGoogleAuthError,
  invalidateConnection,
  GoogleNotConnectedError,
} from '@/lib/google/client'

function buildMime(args: { to: string[]; subject: string; text: string; html?: string }): string {
  const subjectEnc = `=?UTF-8?B?${Buffer.from(args.subject, 'utf8').toString('base64')}?=`
  const base = [`To: ${args.to.join(', ')}`, `Subject: ${subjectEnc}`, 'MIME-Version: 1.0']
  if (args.html) {
    const boundary = 'r360boundary'
    base.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
    const body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(args.text, 'utf8').toString('base64'),
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(args.html, 'utf8').toString('base64'),
      '',
      `--${boundary}--`,
    ].join('\r\n')
    return base.join('\r\n') + '\r\n\r\n' + body
  }
  base.push('Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64')
  return base.join('\r\n') + '\r\n\r\n' + Buffer.from(args.text, 'utf8').toString('base64')
}

/** Exported only for the MIME verify script. */
export const __buildMimeForTest = buildMime

export async function sendGmail(args: {
  orgId: string
  userId: string
  to: string | string[]
  subject: string
  text: string
  html?: string
}): Promise<{ messageId: string }> {
  const auth = await getGoogleClientForUser(args.orgId, args.userId)
  const gmail = google.gmail({ version: 'v1', auth })
  const to = Array.isArray(args.to) ? args.to : [args.to]
  const raw = Buffer.from(buildMime({ to, subject: args.subject, text: args.text, ...(args.html ? { html: args.html } : {}) }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  try {
    const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
    return { messageId: res.data.id! }
  } catch (err) {
    if (isGoogleAuthError(err)) {
      await invalidateConnection(args.orgId, args.userId)
      throw new GoogleNotConnectedError()
    }
    throw err
  }
}
