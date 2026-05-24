/**
 * 24-hour Meta WhatsApp session window guard.
 *
 * Meta only allows free-form messages (text, image, interactive) for 24 hours
 * after the user's last inbound message. Outside that window, only approved
 * templates may be sent.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000

export function isInSessionWindow(lastInboundAtIso: string | null | undefined): boolean {
  if (!lastInboundAtIso) return false
  const ts = Date.parse(lastInboundAtIso)
  if (Number.isNaN(ts)) return false
  return Date.now() - ts < WINDOW_MS
}

export function msUntilWindowCloses(lastInboundAtIso: string | null | undefined): number {
  if (!lastInboundAtIso) return 0
  const ts = Date.parse(lastInboundAtIso)
  if (Number.isNaN(ts)) return 0
  return Math.max(0, WINDOW_MS - (Date.now() - ts))
}
