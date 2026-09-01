/**
 * Shared types/helpers for the renewal-leads API routes (`app/api/v1/renewals/*`).
 *
 * `queue` and `pipeline` both join `renewal_leads` to `properties` and build the
 * identical `RenewalRow` shape that Task 9 renders through the same table
 * component for both tabs — building that mapping twice would let the two
 * copies silently drift (e.g. one route forgetting the `previewError`
 * fallback, or mapping `kind`/`rooms` from a different source). `send-batch`
 * and `send-one` both need to map a `RenewalDispatchResult.code` to an HTTP
 * status, mirroring `send-initial/route.ts`'s `STATUS_FOR_CODE` table with the
 * renewal-only codes added (`SKIPPED`, `SEND_WINDOW`, `APPROVED_PROPERTY`) —
 * see `renewal-dispatcher.ts`'s header/result type for the full code list.
 */

import { normalizePhone } from './phone'
import { supabaseService } from '../supabase'
import { PersonalizationError } from './personalization'
import {
  renewalVarsFromRow,
  renderRenewalPreview,
  RENEWAL_TEMPLATE_PRIVATE,
  RENEWAL_TEMPLATE_REPEAT,
  type RenewalSegment,
} from './renewal-templates'
import { recipientMessageCounts, type RecipientCount } from './governance'

// ---------------------------------------------------------------------------
// Row shape (shared response contract, Task 9 depends on these exact fields)
// ---------------------------------------------------------------------------

export type RenewalRow = {
  leadId: string; propertyId: string; externalId: string
  contactName: string | null; phone: string; phoneAlt: string | null; phoneKind: string | null
  city: string | null; street: string | null; neighborhood: string | null
  kind: string | null; rooms: number | null; sqm: number | null
  priceLast: number | null; priceChangePct: number | null
  delistedAt: string; maturesAt: string; daysOnMarket: number | null; timesListed: number
  segment: RenewalSegment; score: number; status: string
  preview: string | null; previewError?: string
  received: { today: number; week: number }
}

/** Raw shape of a `renewal_leads` row joined to its `properties!inner(...)` row. */
export type RenewalLeadJoinRow = {
  id: string
  property_id: string
  external_id: string
  city: string | null
  street: string | null
  segment: string
  score: number
  status: string
  delisted_at: string
  matures_at: string
  days_on_market: number | null
  times_listed: number
  price_last: number | null
  price_change_pct: number | null
  phone_kind: string | null
  phone_alt: string | null
  properties: {
    contact_name: string | null
    contact_phone: string | null
    neighborhood: string | null
    type: string | null
    sqm: number | null
    rooms: number | null
    street: string | null
    address: string | null
  } | null
}

/**
 * Build one `RenewalRow`, rendering its preview from the already-fetched
 * template bodies (R13 — never hardcode the Hebrew copy here) via the pure
 * `renewalVarsFromRow`/`renderRenewalPreview` (R5 — no per-row query).
 * `PersonalizationError` (unusable name/street) is caught per row so one bad
 * lead can't fail the whole request.
 */
export function buildRenewalRow(
  row: RenewalLeadJoinRow,
  bodyBySegment: { private_once?: string; repeat?: string },
  counts: Record<string, RecipientCount>,
): RenewalRow {
  const property = row.properties
  const segment: RenewalSegment = row.segment === 'repeat' ? 'repeat' : 'private_once'
  const phone = property?.contact_phone || ''

  let received: RecipientCount = { today: 0, week: 0 }
  if (phone) {
    const c = counts[normalizePhone(phone)]
    if (c) received = c
  }

  let preview: string | null = null
  let previewError: string | undefined
  try {
    const vars = renewalVarsFromRow(
      {
        contact_name: property?.contact_name ?? null,
        // `renewal_leads.street/city` are the import-time snapshot (always populated —
        // that's the whole point of denormalizing them onto this table); `properties.street`
        // is a live fallback for the rare case the snapshot is blank.
        street: row.street || property?.street || null,
        address: property?.address ?? null,
        city: row.city,
        neighborhood: property?.neighborhood ?? null,
      },
      row.times_listed,
    )
    const bodyTemplate = bodyBySegment[segment]
    if (!bodyTemplate) {
      previewError = 'template_missing'
    } else {
      preview = renderRenewalPreview(bodyTemplate, vars, segment)
    }
  } catch (err) {
    previewError = err instanceof PersonalizationError ? err.message : 'preview_failed'
  }

  return {
    leadId: row.id,
    propertyId: row.property_id,
    externalId: row.external_id,
    contactName: property?.contact_name ?? null,
    phone,
    phoneAlt: row.phone_alt,
    phoneKind: row.phone_kind,
    city: row.city,
    street: row.street,
    neighborhood: property?.neighborhood ?? null,
    kind: property?.type ?? null,
    rooms: property?.rooms ?? null,
    sqm: property?.sqm ?? null,
    priceLast: row.price_last,
    priceChangePct: row.price_change_pct,
    delistedAt: row.delisted_at,
    maturesAt: row.matures_at,
    daysOnMarket: row.days_on_market,
    timesListed: row.times_listed,
    segment,
    score: row.score,
    status: row.status,
    preview,
    ...(previewError ? { previewError } : {}),
    received,
  }
}

/** recipientMessageCounts runs an IN(phones) query; chunk so a full page of rows stays well under URL limits — mirrors `landlord-queue/route.ts`. */
export async function renewalCountsChunked(
  orgId: string,
  phones: string[],
): Promise<Record<string, RecipientCount>> {
  const merged: Record<string, RecipientCount> = {}
  for (let i = 0; i < phones.length; i += 120) {
    Object.assign(merged, await recipientMessageCounts(orgId, phones.slice(i, i + 120)))
  }
  return merged
}

// ---------------------------------------------------------------------------
// Grade → score-range filter (A→80+, B→60-79, C→40-59, D→<40)
// ---------------------------------------------------------------------------

export type Grade = 'A' | 'B' | 'C' | 'D'
export type ScoreRange = { gte?: number; lte?: number; lt?: number }

/**
 * Normalize a raw `grade` query-string value into a valid enum member or `null` — the SINGLE
 * normalization path for this parameter. A route that reads `grade` raw and hands it to more than
 * one downstream consumer (a JS-side filter AND a SQL RPC, e.g.) must call this exactly once and
 * reuse the returned value everywhere, never re-derive it from the raw string a second time.
 *
 * (Task 8 fix round 1: the pipeline route used to pass the untouched raw string to the
 * `renewal_leads_aggregates` RPC while routing the same param through `gradeScoreRange`'s OWN
 * internal `.toUpperCase()` for the row query — two normalization paths for one input. `?grade=a`
 * matched rows correctly but the RPC's exact-case `p_grade = 'A'` matched nothing, so `aggregates`
 * silently came back all-zero while `rows`/`total` were correct. Same failure shape for any
 * grade value outside `A`/`B`/`C`/`D`: `gradeScoreRange` treats it as "no filter" while the RPC's
 * `p_grade is null or …` treats a non-null-but-unmatched string as "filter to nothing" — collapsed
 * here into one function so both callers can only ever see the same already-validated value.)
 */
export function normalizeGrade(raw: string | null | undefined): Grade | null {
  const g = (raw || '').trim().toUpperCase()
  return g === 'A' || g === 'B' || g === 'C' || g === 'D' ? g : null
}

/**
 * Takes an already-normalized grade (`normalizeGrade`) — this function does no parsing of its own.
 *
 * Grade boundaries (80/60/40) are duplicated in three other places that cannot share code across
 * JS/TSX/SQL — keep all four in sync when changing these numbers: scripts/lib/renewal-merge.mjs
 * (`gradeFor`), components/renewals/RenewalQueue.tsx (`gradeForScore`), and the CASE in
 * supabase/migrations/0039_renewal_leads_aggregates_rpc.sql.
 */
export function gradeScoreRange(grade: Grade | null): ScoreRange | null {
  switch (grade) {
    case 'A': return { gte: 80 }
    case 'B': return { gte: 60, lte: 79 }
    case 'C': return { gte: 40, lte: 59 }
    case 'D': return { lt: 40 }
    default: return null
  }
}

// ---------------------------------------------------------------------------
// Template approval status, read once per request (R13)
// ---------------------------------------------------------------------------

export type TemplateStatusLabel = 'approved' | 'pending' | 'missing'

function labelForStatus(status: string | undefined): TemplateStatusLabel {
  if (!status) return 'missing'
  return status === 'approved' ? 'approved' : 'pending'
}

/**
 * Load both renewal template rows in a single query. Returns the body text
 * per segment (for preview rendering) and the `templates.{private,repeat}`
 * status labels the response contract requires.
 */
export async function loadRenewalTemplates(): Promise<{
  bodyBySegment: { private_once?: string; repeat?: string }
  templates: { private: TemplateStatusLabel; repeat: TemplateStatusLabel }
}> {
  const sb = supabaseService()
  const { data } = await sb
    .from('whatsapp_templates')
    .select('name, status, body_template')
    .eq('language', 'he')
    .in('name', [RENEWAL_TEMPLATE_PRIVATE, RENEWAL_TEMPLATE_REPEAT])

  const byName = new Map<string, { status: string; body_template: string }>()
  for (const t of data || []) byName.set(t.name as string, { status: t.status as string, body_template: t.body_template as string })

  const privateRow = byName.get(RENEWAL_TEMPLATE_PRIVATE)
  const repeatRow = byName.get(RENEWAL_TEMPLATE_REPEAT)

  return {
    bodyBySegment: {
      ...(privateRow ? { private_once: privateRow.body_template } : {}),
      ...(repeatRow ? { repeat: repeatRow.body_template } : {}),
    },
    templates: {
      private: labelForStatus(privateRow?.status),
      repeat: labelForStatus(repeatRow?.status),
    },
  }
}

// ---------------------------------------------------------------------------
// HTTP status mapping for RenewalDispatchResult failure codes
// (mirrors send-initial/route.ts's STATUS_FOR_CODE, plus the renewal-only codes)
// ---------------------------------------------------------------------------

export const RENEWAL_STATUS_FOR_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  BLOCKED: 403,
  SUPPRESSED: 403,
  ALREADY_SENT: 409,
  SKIPPED: 409,
  APPROVED_PROPERTY: 409,
  PHONE_MISSING: 422,
  PERSONALIZATION: 422,
  SEND_WINDOW: 503,
  TEMPLATE_MISSING: 500,
  TEMPLATE_NOT_APPROVED: 503,
  META_SEND_FAILED: 502,
  DB_ERROR: 500,
}
