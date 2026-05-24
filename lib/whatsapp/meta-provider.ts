/**
 * Meta WhatsApp Business Cloud API provider (Graph API v23.0).
 *
 * Wraps the four send shapes we use plus the inbound webhook parser
 * and signature verification. All callers should go through this module
 * — never hit Meta's API directly from route handlers.
 *
 * Meta's 24-hour session window:
 *  - Template messages (`sendTemplate`) can be sent any time to opted-in users.
 *  - Free-form text/media/interactive (`sendText`, `sendInteractive`, `sendImage`)
 *    can only be sent within 24h of the user's last inbound message.
 *  - Use `lib/whatsapp/window-guard.ts` (called by orchestration code) to enforce
 *    this before invoking the free-form sends.
 *
 * Env vars: see .env.example META_WHATSAPP_* block.
 */

import crypto from 'crypto'

const META_API_BASE = 'https://graph.facebook.com/v23.0'

type MetaSendResponse = {
  messaging_product: 'whatsapp'
  contacts: Array<{ input: string; wa_id: string }>
  messages: Array<{ id: string; message_status?: string }>
}

export class MetaConfigError extends Error {
  constructor(missing: string[]) {
    super(`Meta WhatsApp env not configured (missing: ${missing.join(', ')})`)
    this.name = 'MetaConfigError'
  }
}

export class MetaSendError extends Error {
  status: number
  body: unknown
  constructor(status: number, body: unknown) {
    const msg = typeof body === 'object' && body && 'error' in (body as any)
      ? (body as any).error?.message || JSON.stringify(body)
      : String(body)
    super(`Meta WhatsApp send failed (${status}): ${msg}`)
    this.name = 'MetaSendError'
    this.status = status
    this.body = body
  }
}

function getConfig() {
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID
  const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN
  const missing: string[] = []
  if (!phoneNumberId) missing.push('META_WHATSAPP_PHONE_NUMBER_ID')
  if (!accessToken) missing.push('META_WHATSAPP_ACCESS_TOKEN')
  if (missing.length) throw new MetaConfigError(missing)
  return { phoneNumberId: phoneNumberId!, accessToken: accessToken! }
}

/** Normalize an Israeli phone to E.164 form Meta expects (no `+`, no leading zero). */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '')
  if (digits.startsWith('972')) return digits
  if (digits.startsWith('0')) return '972' + digits.slice(1)
  return digits
}

async function metaPost(body: object): Promise<MetaSendResponse> {
  const { phoneNumberId, accessToken } = getConfig()
  const res = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new MetaSendError(res.status, json)
  return json as MetaSendResponse
}

// ---------- Send: template (works any time, requires Meta approval) ---------

export type TemplateComponentParam =
  | { type: 'text'; text: string }
  | { type: 'currency'; currency: { fallback_value: string; code: string; amount_1000: number } }
  | { type: 'date_time'; date_time: { fallback_value: string } }

export type TemplateComponent =
  | { type: 'header'; parameters?: TemplateComponentParam[] }
  | { type: 'body'; parameters?: TemplateComponentParam[] }
  | { type: 'button'; sub_type: 'quick_reply' | 'url'; index: number; parameters: TemplateComponentParam[] }

export async function sendTemplate(opts: {
  to: string
  name: string
  language?: string
  components?: TemplateComponent[]
}): Promise<{ messageId: string }> {
  const { to, name, language = 'he', components } = opts
  const r = await metaPost({
    messaging_product: 'whatsapp',
    to: normalizePhone(to),
    type: 'template',
    template: {
      name,
      language: { code: language },
      ...(components && components.length > 0 ? { components } : {}),
    },
  })
  return { messageId: r.messages[0]!.id }
}

// ---------- Send: free-form text (24h window only) -------------------------

export async function sendText(to: string, body: string): Promise<{ messageId: string }> {
  const r = await metaPost({
    messaging_product: 'whatsapp',
    to: normalizePhone(to),
    type: 'text',
    text: { preview_url: false, body },
  })
  return { messageId: r.messages[0]!.id }
}

// ---------- Send: image with optional caption (24h window only) ------------

export async function sendImage(opts: {
  to: string
  link: string
  caption?: string | undefined
}): Promise<{ messageId: string }> {
  const { to, link, caption } = opts
  const r = await metaPost({
    messaging_product: 'whatsapp',
    to: normalizePhone(to),
    type: 'image',
    image: { link, ...(caption ? { caption } : {}) },
  })
  return { messageId: r.messages[0]!.id }
}

// ---------- Send: interactive reply buttons (24h window only) --------------

export type ReplyButton = { id: string; title: string }

export async function sendInteractiveButtons(opts: {
  to: string
  body: string
  buttons: ReplyButton[]
  header?: string | undefined
  footer?: string | undefined
}): Promise<{ messageId: string }> {
  const { to, body, buttons, header, footer } = opts
  if (buttons.length === 0 || buttons.length > 3) {
    throw new Error('WhatsApp reply buttons: 1-3 required')
  }
  for (const b of buttons) {
    if (b.title.length > 20) throw new Error(`button title >20 chars: ${b.title}`)
  }
  const r = await metaPost({
    messaging_product: 'whatsapp',
    to: normalizePhone(to),
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(header ? { header: { type: 'text', text: header } } : {}),
      body: { text: body },
      ...(footer ? { footer: { text: footer } } : {}),
      action: {
        buttons: buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
      },
    },
  })
  return { messageId: r.messages[0]!.id }
}

// ---------- Send: interactive list (24h window only) ----------------------

export type ListSection = {
  title?: string
  rows: Array<{ id: string; title: string; description?: string }>
}

export async function sendInteractiveList(opts: {
  to: string
  body: string
  buttonLabel: string
  sections: ListSection[]
  header?: string | undefined
  footer?: string | undefined
}): Promise<{ messageId: string }> {
  const { to, body, buttonLabel, sections, header, footer } = opts
  const r = await metaPost({
    messaging_product: 'whatsapp',
    to: normalizePhone(to),
    type: 'interactive',
    interactive: {
      type: 'list',
      ...(header ? { header: { type: 'text', text: header } } : {}),
      body: { text: body },
      ...(footer ? { footer: { text: footer } } : {}),
      action: {
        button: buttonLabel,
        sections: sections.map(s => ({
          ...(s.title ? { title: s.title } : {}),
          rows: s.rows.map(r => ({
            id: r.id,
            title: r.title,
            ...(r.description ? { description: r.description } : {}),
          })),
        })),
      },
    },
  })
  return { messageId: r.messages[0]!.id }
}

// ---------- Mark message as read (recommended after handling inbound) ------

export async function markRead(externalMessageId: string): Promise<void> {
  const { phoneNumberId, accessToken } = getConfig()
  await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: externalMessageId,
    }),
  }).catch(() => {/* fire-and-forget */})
}

// ---------- Media download (two-call dance) -------------------------------

export async function downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const { accessToken } = getConfig()
  const metaRes = await fetch(`${META_API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!metaRes.ok) throw new MetaSendError(metaRes.status, await metaRes.json().catch(() => ({})))
  const metaJson = await metaRes.json() as { url: string; mime_type: string }
  const fileRes = await fetch(metaJson.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!fileRes.ok) throw new MetaSendError(fileRes.status, 'media download failed')
  const arr = await fileRes.arrayBuffer()
  return { buffer: Buffer.from(arr), mimeType: metaJson.mime_type }
}

// ---------- Inbound webhook parsing & signature verification --------------

export type InboundMessage = {
  externalId: string         // Meta's wamid
  from: string               // E.164 sender (no leading +)
  phoneNumberId: string      // our number that received the message
  timestamp: number          // unix seconds
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location' | 'interactive' | 'button' | 'reaction' | 'unsupported'
  text?: string | undefined
  mediaId?: string | undefined
  interactive?: { type: 'button_reply' | 'list_reply'; id: string; title: string } | undefined
  raw: unknown
}

export type InboundStatus = {
  externalId: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  timestamp: number
  errorCode?: number
  errorMessage?: string
  raw: unknown
}

export type InboundEvent =
  | { kind: 'message'; message: InboundMessage }
  | { kind: 'status'; status: InboundStatus }

export function parseInboundWebhook(payload: unknown): InboundEvent[] {
  const events: InboundEvent[] = []
  if (!payload || typeof payload !== 'object') return events
  const p = payload as any
  if (p.object !== 'whatsapp_business_account' || !Array.isArray(p.entry)) return events

  for (const entry of p.entry) {
    if (!Array.isArray(entry.changes)) continue
    for (const change of entry.changes) {
      const value = change.value
      if (!value) continue
      const phoneNumberId = value.metadata?.phone_number_id || ''

      // Inbound messages
      if (Array.isArray(value.messages)) {
        for (const m of value.messages) {
          const base: Pick<InboundMessage, 'externalId' | 'from' | 'phoneNumberId' | 'timestamp' | 'raw'> = {
            externalId: m.id,
            from: m.from,
            phoneNumberId,
            timestamp: Number(m.timestamp),
            raw: m,
          }
          if (m.type === 'text') {
            events.push({ kind: 'message', message: { ...base, type: 'text', text: m.text?.body || '' } })
          } else if (m.type === 'image' || m.type === 'audio' || m.type === 'video' || m.type === 'document' || m.type === 'sticker') {
            events.push({ kind: 'message', message: { ...base, type: m.type, mediaId: m[m.type]?.id, text: m[m.type]?.caption } })
          } else if (m.type === 'interactive') {
            const reply = m.interactive?.button_reply || m.interactive?.list_reply
            events.push({
              kind: 'message',
              message: {
                ...base,
                type: 'interactive',
                interactive: reply
                  ? {
                      type: m.interactive.button_reply ? 'button_reply' : 'list_reply',
                      id: reply.id,
                      title: reply.title,
                    }
                  : undefined,
                text: reply?.title,
              },
            })
          } else if (m.type === 'location') {
            events.push({ kind: 'message', message: { ...base, type: 'location' } })
          } else if (m.type === 'button') {
            events.push({ kind: 'message', message: { ...base, type: 'button', text: m.button?.text } })
          } else if (m.type === 'reaction') {
            events.push({ kind: 'message', message: { ...base, type: 'reaction', text: m.reaction?.emoji } })
          } else {
            events.push({ kind: 'message', message: { ...base, type: 'unsupported' } })
          }
        }
      }

      // Status updates (delivery receipts, read receipts, send failures)
      if (Array.isArray(value.statuses)) {
        for (const s of value.statuses) {
          events.push({
            kind: 'status',
            status: {
              externalId: s.id,
              status: s.status,
              timestamp: Number(s.timestamp),
              errorCode: s.errors?.[0]?.code,
              errorMessage: s.errors?.[0]?.message,
              raw: s,
            },
          })
        }
      }
    }
  }
  return events
}

/**
 * Verify Meta's X-Hub-Signature-256 header against the raw request body using
 * the Facebook app secret. Always use timingSafeEqual to avoid timing attacks.
 */
export function verifyWebhookSignature(rawBody: string, headerValue: string | null): boolean {
  const appSecret = process.env.META_WHATSAPP_APP_SECRET
  if (!appSecret || !headerValue) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
  const a = Buffer.from(headerValue)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export function isMetaConfigured(): boolean {
  return !!(process.env.META_WHATSAPP_PHONE_NUMBER_ID && process.env.META_WHATSAPP_ACCESS_TOKEN)
}
