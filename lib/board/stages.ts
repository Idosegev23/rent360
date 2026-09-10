/**
 * The seven agent-owned stages of the deal board and the one read-time rule that overrides them.
 * Pure — no server imports — so the API and the client page share one definition.
 * Spec: docs/superpowers/specs/2026-09-10-agent-deal-board-design.md §1.
 */
export const STAGES = [
  { key: 'new', label: 'חדש' },
  { key: 'waiting_owner', label: 'ממתין למענה מבעל הבית' },
  { key: 'scheduling_viewing', label: 'בתיאום צפייה' },
  { key: 'viewed', label: 'צפייה בוצעה' },
  { key: 'docs_pending', label: 'ממתין למסמכים וצ׳קים' },
  { key: 'signed', label: 'חוזה נחתם' },
  { key: 'stuck', label: 'תקוע' },
] as const

export type StageKey = (typeof STAGES)[number]['key']

export const STAGE_KEYS: readonly StageKey[] = STAGES.map(s => s.key)

/** `signed` is never set by hand — an active tenancy is what makes a property signed. */
export const MANUAL_STAGE_KEYS: readonly StageKey[] = STAGE_KEYS.filter(k => k !== 'signed')

export function isStageKey(v: unknown): v is StageKey {
  return typeof v === 'string' && (STAGE_KEYS as readonly string[]).includes(v)
}

export function stageLabel(k: StageKey): string {
  return STAGES.find(s => s.key === k)?.label ?? k
}

/** Active tenancy wins (ground truth a contract exists); else the stored stage; else `new`. */
export function effectiveStage(stored: StageKey | null, hasActiveTenancy: boolean): StageKey {
  if (hasActiveTenancy) return 'signed'
  return stored ?? 'new'
}

/** Whole days from `iso` to `now`, never negative. Null → 0. */
export function daysSince(iso: string | null, now: Date = new Date()): number {
  if (!iso) return 0
  const ms = now.getTime() - new Date(iso).getTime()
  return ms > 0 ? Math.floor(ms / 86_400_000) : 0
}

/** 'YYYY-MM-01' for the month containing `d`, in Israel time. */
export function monthStartIso(d: Date = new Date()): string {
  return `${d.toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }).slice(0, 7)}-01`
}

/** The first day of the month after `monthStart` ('YYYY-MM-01'). */
export function nextMonthStartIso(monthStart: string): string {
  const [y, m] = monthStart.split('-').map(Number)
  const year = y ?? 1970
  const month = m ?? 1
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`
}
