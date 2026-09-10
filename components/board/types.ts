import type { StageKey } from '../../lib/board/stages'

// Client mirror of GET /api/v1/board (app/api/v1/board/route.ts). Kept separate so the client bundle
// never imports the route module.
export type BoardItem = {
  propertyId: string
  label: string
  ownerName: string | null
  ownerPhone: string | null
  stage: StageKey
  daysInStage: number
  note: string | null
  nextTask: { id: string; title: string; dueAt: string | null } | null
  nextMeeting: { id: string; title: string; startsAt: string } | null
  updatedBy: string | null
  updatedAt: string | null
}

export type BoardTargets = {
  month: string
  targetDeals: number
  targetCommission: number
  actualDeals: number
  actualCommission: number
}

export type BoardData = {
  me: { id: string }
  /** The agent this payload describes — the targets form writes for this id, not the selector's. */
  agentId: string
  agents: Array<{ id: string; name: string }>
  targets: BoardTargets
  orphans: BoardItem[]
  groups: Array<{ stage: StageKey; label: string; items: BoardItem[] }>
}

export const STAGE_TONE: Record<StageKey, string> = {
  new: 'pill-gray',
  waiting_owner: 'pill-amber',
  scheduling_viewing: 'pill-blue',
  viewed: 'pill-purple',
  docs_pending: 'pill-brand',
  signed: 'pill-green',
  stuck: 'pill-red',
}

export function fmtShortDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' })
}

export function fmtShekel(n: number): string {
  return `₪${Math.round(n).toLocaleString('he-IL')}`
}

/** Days in a stage, the way Hebrew says it. */
export function fmtDays(n: number): string {
  if (n <= 0) return 'היום'
  if (n === 1) return 'יום אחד'
  if (n === 2) return 'יומיים'
  return `${n} ימים`
}
