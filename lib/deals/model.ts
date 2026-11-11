/**
 * Deal control board: statuses, option lists and the derived values (effective status, expected fee,
 * forecast buckets). Pure — shared by the API and the page. DB: supabase/migrations/0045_property_deals.sql.
 */

export const WORK_STATUSES = [
  { key: 'new_recruit', label: 'גיוס חדש' },
  { key: 'photo_publish', label: 'צילום ופרסום' },
  { key: 'tours_marketing', label: 'סיורים ושיווק' },
  { key: 'offer_submitted', label: 'הוגשה הצעה' },
  { key: 'negotiation_draft', label: 'משא ומתן וטיוטת חוזה' },
  { key: 'docs_check', label: 'בדיקת מסמכים וערבים' },
  { key: 'contract_signing', label: 'חתימת חוזה' },
  { key: 'closed_paid', label: 'נסגר, שולם והופקה קבלה' },
  { key: 'frozen_cancelled', label: 'מוקפא או בוטל' },
] as const
export type WorkStatus = (typeof WORK_STATUSES)[number]['key']
export const WORK_STATUS_KEYS = WORK_STATUSES.map(s => s.key) as readonly WorkStatus[]

export const RECRUIT_SOURCES = [
  { key: 'yad2', label: 'יד2' },
  { key: 'nadlan_one', label: 'נדל״ן וואן' },
  { key: 'facebook', label: 'פייסבוק' },
  { key: 'past_client', label: 'לקוח עבר' },
  { key: 'other', label: 'אחר' },
] as const
export type RecruitSource = (typeof RECRUIT_SOURCES)[number]['key']

export const DOCS_STATUSES = [
  { key: 'not_started', label: 'טרם נבדקו' },
  { key: 'in_review', label: 'בבדיקה' },
  { key: 'missing', label: 'חסרים מסמכים' },
  { key: 'approved', label: 'אושרו' },
] as const
export type DocsStatus = (typeof DOCS_STATUSES)[number]['key']

export const PAYMENT_STATUSES = [
  { key: 'pending', label: 'ממתין לגבייה' },
  { key: 'collected', label: 'נגבה' },
  { key: 'waived', label: 'ויתור' },
] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]['key']

export const PAYMENT_METHODS = [
  { key: 'bank_transfer', label: 'העברה בנקאית' },
  { key: 'cash', label: 'מזומן' },
  { key: 'other', label: 'אחר' },
] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]['key']

const labelOf = <T extends { key: string; label: string }>(list: readonly T[], key: string | null | undefined): string =>
  list.find(i => i.key === key)?.label ?? ''
export const statusLabel = (k: string | null | undefined) => labelOf(WORK_STATUSES, k)
export const sourceLabel = (k: string | null | undefined) => labelOf(RECRUIT_SOURCES, k)
export const docsLabel = (k: string | null | undefined) => labelOf(DOCS_STATUSES, k)
export const paymentStatusLabel = (k: string | null | undefined) => labelOf(PAYMENT_STATUSES, k)
export const paymentMethodLabel = (k: string | null | undefined) => labelOf(PAYMENT_METHODS, k)

export const isWorkStatus = (v: unknown): v is WorkStatus => typeof v === 'string' && (WORK_STATUS_KEYS as readonly string[]).includes(v)
const statusIndex = (s: WorkStatus) => WORK_STATUS_KEYS.indexOf(s)

/** Stages that count as "a deal in progress": an offer exists but the contract isn't signed yet. */
export const IN_PROCESS: readonly WorkStatus[] = ['offer_submitted', 'negotiation_draft', 'docs_check', 'contract_signing']
/** Done or dead — hidden from the default "open" view. */
export const FINISHED: readonly WorkStatus[] = ['closed_paid', 'frozen_cancelled']

/**
 * Status shown on the board. An active tenancy proves a contract exists, so a property still marked
 * earlier than "חתימת חוזה" reads as signed; frozen/closed are never overridden.
 */
export function effectiveStatus(stored: string | null | undefined, hasActiveTenancy: boolean): WorkStatus {
  const s: WorkStatus = isWorkStatus(stored) ? stored : 'new_recruit'
  if (!hasActiveTenancy) return s
  if (s === 'closed_paid' || s === 'frozen_cancelled') return s
  return statusIndex(s) < statusIndex('contract_signing') ? 'contract_signing' : s
}

/** properties.source is the scraper/channel that created the row; map it onto the recruitment channels. */
export function deriveRecruitSource(propertySource: string | null | undefined): RecruitSource {
  const s = (propertySource || '').toLowerCase()
  if (s === 'יד2' || s === 'yad2') return 'yad2'
  if (s === 'nadlanone_renewal' || s === 'nadlan_one') return 'nadlan_one'
  if (s === 'facebook' || s === 'facebook_onboarding') return 'facebook'
  if (s === 'past_deal_import') return 'past_client'
  return 'other'
}

/**
 * Expected brokerage fee in ₪ (VAT-inclusive, one month's rent by default — see the commission model).
 * Priority: manual override on the deal → fixed amount agreed with the landlord → agreed months × rent → one month.
 */
export function expectedFee(args: {
  override: number | null
  agreedAmount: number | null
  agreedMonths: number | null
  rent: number | null
}): number | null {
  const { override, agreedAmount, agreedMonths, rent } = args
  if (override != null) return Math.round(override)
  if (agreedAmount != null) return Math.round(agreedAmount)
  if (rent == null || !(rent > 0)) return null
  const months = agreedMonths != null && agreedMonths > 0 ? agreedMonths : 1
  return Math.round(months * rent)
}

/** 'YYYY-MM' of an ISO date/timestamp, or null. */
export function monthKey(v: string | null | undefined): string | null {
  if (!v) return null
  return /^\d{4}-\d{2}/.test(v) ? v.slice(0, 7) : null
}

export type ForecastRow = {
  month: string | null      // 'YYYY-MM', or null = no expected date
  agentId: string | null    // handling agent
  deals: number
  fee: number
}

/** In-process deals bucketed by expected month and handling agent. */
export function buildForecast(deals: Array<{ status: WorkStatus; month: string | null; agentId: string | null; fee: number | null }>): ForecastRow[] {
  const map = new Map<string, ForecastRow>()
  for (const d of deals) {
    if (!IN_PROCESS.includes(d.status)) continue
    const key = `${d.month ?? ''}|${d.agentId ?? ''}`
    const row = map.get(key) ?? { month: d.month, agentId: d.agentId, deals: 0, fee: 0 }
    row.deals += 1
    row.fee += d.fee ?? 0
    map.set(key, row)
  }
  return Array.from(map.values()).sort((a, b) => (a.month ?? '9999').localeCompare(b.month ?? '9999') || (a.agentId ?? '').localeCompare(b.agentId ?? ''))
}

/** One row of the deal control board (GET /api/v1/deals). */
export type DealRow = {
  propertyId: string
  address: string
  city: string
  ownerName: string | null
  ownerPhone: string | null
  rooms: number | null
  askingPrice: number | null
  recruitedAt: string | null
  recruitSource: string
  recruitSourceDerived: boolean
  recruiterId: string | null
  handlerId: string | null
  status: WorkStatus
  daysInStatus: number
  expectedCloseDate: string | null
  closingPrice: number | null
  renterName: string | null
  renterPhone: string | null
  signingDate: string | null
  docsStatus: string
  expectedFee: number | null
  feeIsOverride: boolean
  paymentStatus: string
  paymentMethod: string | null
  invoiceNumber: string | null
  collectedAt: string | null
  note: string | null
  hasTenancy: boolean
}
