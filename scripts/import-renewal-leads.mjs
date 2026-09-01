/**
 * Renewal-leads import — Task 4: read + plan phase, DRY RUN ONLY.
 *
 * This build of the script has NO write code path — no `.insert()`, `.update()`, or `.upsert()`
 * call appears anywhere below. It loads the Nadlan One exports (via `buildRenewalRecords`),
 * loads the org's existing `properties` / `whatsapp_suppression` / `approved_properties` state,
 * classifies every export record into a plan (create / update / skip-with-reason), and prints
 * that plan. Nothing is written to the database — that is not a runtime choice guarded by a
 * flag, it is a structural fact: the write functions don't exist in this file yet. Task 5 adds
 * them. `--dry-run` is required on the CLI for now so the eventual write-mode flag stays stable
 * once Task 5 lands (omitting it is refused, not silently treated as a write that can't happen).
 *
 * Run:
 *   set -a; . ./.env.local; set +a; NODE_PATH="$(pwd)/node_modules" \
 *     node scripts/import-renewal-leads.mjs \
 *       --properties docs/wehouse_haifa_properties.csv \
 *       --movements  docs/wehouse_haifa_movements.csv \
 *       --dry-run
 *
 * ---------------------------------------------------------------------------------------------
 * Known-defect rulings applied here (see task-4-brief.md for the original, unpatched text):
 *
 * R1 — the brief's patch-builder loop reads `rec[col]` for col in
 *      ['neighborhood','street','sqm','floor','rooms','price']. `renewal-merge.mjs` records have
 *      no `price` (it's `priceLast`) and no `type` (it's `kind`). Mapped explicitly below —
 *      no shared-name loop. `type` only matters for NEW properties (buildNewPropertyRow); the
 *      existing-property writable allowlist never included `type`.
 * R2 — `scraped_metadata` is now in the existing-properties SELECT (loadExistingProperties)
 *      so `buildUpdatePatch`'s spread of `existing.scraped_metadata` is real data, and
 *      `previous_phone` is actually preserved.
 * R3 — the brief calls an undefined `normalize()`. Replaced with `phoneLeadingZero()`, which
 *      runs `properties.contact_phone` (raw, e.g. " 050-2011474") through
 *      `renewal-merge.mjs`'s `parsePhones()` — the same leading-zero form `rec.phone` is already
 *      in — so the two sides of the comparison are actually comparable.
 * R4b — suppression membership. `whatsapp_suppression.phone` is E.164 WITHOUT a leading '+'
 *      (e.g. "972502011474" — confirmed live via `lib/outreach/suppression.ts` /
 *      `lib/outreach/phone.ts`, which both delegate to `lib/whatsapp/meta-provider.ts`'s
 *      `normalizePhone`). `rec.phone` is the LEADING-ZERO form ("0502011474"). These are
 *      DIFFERENT normalizations and must never be compared directly — see `phoneLeadingZero()`
 *      vs `phoneE164NoPlus()` below, kept as two separate functions on purpose so the two
 *      comparisons (contact_phone fill/conflict vs. suppression membership) can never collapse
 *      into one by accident.
 * ---------------------------------------------------------------------------------------------
 */
import { createClient } from '@supabase/supabase-js'
import { buildRenewalRecords, parsePhones } from './lib/renewal-merge.mjs'

const DEFAULT_ORG = '11111111-1111-1111-1111-111111111111'
const CHUNK_SIZE = 200 // Supabase .in() over ~13k ids must be chunked or the URL blows the length limit.

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { org: DEFAULT_ORG, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--properties') opts.propertiesCsv = argv[++i]
    else if (a === '--movements') opts.movementsCsv = argv[++i]
    else if (a === '--org') opts.org = argv[++i]
    else if (a === '--dry-run') opts.dryRun = true
    else {
      console.error(`Unknown argument: ${a}`)
      process.exit(1)
    }
  }
  if (!opts.propertiesCsv || !opts.movementsCsv) {
    console.error(
      'Usage: node scripts/import-renewal-leads.mjs --properties <csv> --movements <csv> [--org <uuid>] --dry-run'
    )
    process.exit(1)
  }
  return opts
}

// ---------------------------------------------------------------------------
// Phone normalization — TWO separate forms, kept as two separate functions.
// Never use one where the other belongs (see R3 / R4b above).
// ---------------------------------------------------------------------------

/**
 * Leading-zero form ("0502011474"), for comparing DB `properties.contact_phone` (stored raw,
 * e.g. " 050-2011474") against `rec.phone` (already in this form via renewal-merge's
 * `parsePhones`). Use ONLY for the contact_phone fill/conflict check in `buildUpdatePatch`.
 */
function phoneLeadingZero(raw) {
  const [first] = parsePhones(raw)
  return first || null
}

/**
 * E.164-without-'+' form ("972502011474"), mirroring `lib/whatsapp/meta-provider.ts`'s
 * `normalizePhone()`: strip non-digits; a 972-prefixed number stays; a 0-prefixed number has the
 * leading 0 replaced with 972. Use ONLY for `whatsapp_suppression` membership checks.
 */
function phoneE164NoPlus(raw) {
  const digits = String(raw || '').replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('972')) return digits
  if (digits.startsWith('0')) return '972' + digits.slice(1)
  return digits
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// ---------------------------------------------------------------------------
// Supabase loaders — all org_id-filtered, all read-only.
// ---------------------------------------------------------------------------

async function loadExistingProperties(sb, orgId, externalIds) {
  const map = new Map()
  const uniqueIds = Array.from(new Set(externalIds))
  for (const slice of chunk(uniqueIds, CHUNK_SIZE)) {
    const { data, error } = await sb
      .from('properties')
      // R2: scraped_metadata included so buildUpdatePatch's spread preserves existing data
      // instead of overwriting it with undefined.
      .select(
        'id, external_id, contact_phone, contact_name, neighborhood, street, sqm, floor, rooms, price, outreach_blocked, scraped_metadata'
      )
      .eq('org_id', orgId)
      .in('external_id', slice)
    if (error) throw new Error(`properties lookup failed: ${error.message}`)
    for (const row of data || []) map.set(row.external_id, row)
  }
  return map
}

async function loadSuppressionSet(sb, orgId) {
  const { data, error } = await sb.from('whatsapp_suppression').select('phone').eq('org_id', orgId)
  if (error) throw new Error(`whatsapp_suppression lookup failed: ${error.message}`)
  const set = new Set()
  for (const row of data || []) {
    // Defensive re-normalization: the table is written via normalizePhone() already (see
    // lib/outreach/phone.ts), but re-applying the same E.164-without-'+' form here costs
    // nothing and protects against any legacy/dirty row.
    const norm = phoneE164NoPlus(row.phone)
    if (norm) set.add(norm)
  }
  return set
}

async function loadApprovedPropertyIds(sb, orgId) {
  const { data, error } = await sb.from('approved_properties').select('property_id').eq('org_id', orgId)
  if (error) throw new Error(`approved_properties lookup failed: ${error.message}`)
  return new Set((data || []).map((r) => r.property_id))
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** New property row. `title`/`city` are NOT NULL; `is_active` must be explicitly false. */
function buildNewPropertyRow(orgId, rec, now) {
  const city = rec.city || 'לא ידוע' // NOT NULL guard — the export always has a city (0/13463 null in practice)
  const kind = rec.kind || 'נכס'
  const roomsForTitle = rec.rooms != null ? rec.rooms : ''
  const streetForTitle = rec.street || city
  const title = `${kind} ${roomsForTitle} חדרים ב${streetForTitle}, ${city}`

  return {
    org_id: orgId,
    external_id: rec.externalId,
    source: 'nadlanone_renewal',
    is_active: false,
    title,
    city,
    neighborhood: rec.neighborhood,
    street: rec.street,
    address: rec.street,
    type: rec.kind, // R1: rec has `kind`, not `type`
    rooms: rec.rooms,
    sqm: rec.sqm,
    floor: rec.floor,
    price: rec.priceLast, // R1: rec has `priceLast`, not `price`
    contact_name: rec.contactName,
    contact_phone: rec.phone,
    images: rec.images,
    amenities: rec.amenities,
    timeline: rec.timeline,
    scraped_metadata: {
      renewal_import: {
        at: now.toISOString(),
        source: 'nadlanone',
        delisted_at: rec.delistedAt,
      },
    },
  }
}

/**
 * Explicit allowlist patch for an EXISTING property. Nothing outside this list may ever be
 * written: contact_phone, contact_name, neighborhood, street, sqm, floor, rooms, price,
 * timeline, scraped_metadata. Everything else — initial_message_sent, outreach_blocked,
 * is_active, landlord_id, assigned_agent_user_id, agreed_commission_*, status — is off-limits.
 *
 * Returns { patch, phoneFill, phoneConflict } — the two booleans let the caller tally
 * plan.phoneFills / plan.phoneConflicts without re-deriving the branch that was taken.
 */
function buildUpdatePatch(existing, rec, now) {
  const patch = {}
  let phoneFill = false
  let phoneConflict = false

  // R3: leading-zero comparison (phoneLeadingZero), not the brief's undefined normalize().
  if (!existing.contact_phone && rec.phone) {
    patch.contact_phone = rec.phone
    phoneFill = true
  } else if (
    existing.contact_phone &&
    rec.phone &&
    phoneLeadingZero(existing.contact_phone) !== phoneLeadingZero(rec.phone)
  ) {
    patch.contact_phone = rec.phone // Nadlan One wins; previous value preserved below.
    phoneConflict = true
  }

  if (!existing.contact_name && rec.contactName) patch.contact_name = rec.contactName

  // R1: explicit 1:1 field map — no shared-name loop, no `rec.price`/`rec.type`.
  if (existing.neighborhood == null && rec.neighborhood != null) patch.neighborhood = rec.neighborhood
  if (existing.street == null && rec.street != null) patch.street = rec.street
  if (existing.sqm == null && rec.sqm != null) patch.sqm = rec.sqm
  if (existing.floor == null && rec.floor != null) patch.floor = rec.floor
  if (existing.rooms == null && rec.rooms != null) patch.rooms = rec.rooms
  if (existing.price == null && rec.priceLast != null) patch.price = rec.priceLast

  patch.timeline = rec.timeline
  // R2: existing.scraped_metadata was selected, so this is a real spread, not `...undefined`.
  patch.scraped_metadata = {
    ...(existing.scraped_metadata || {}),
    renewal_import: {
      at: now.toISOString(),
      source: 'nadlanone',
      delisted_at: rec.delistedAt,
      ...(patch.contact_phone && existing.contact_phone ? { previous_phone: existing.contact_phone } : {}),
    },
  }

  return { patch, phoneFill, phoneConflict }
}

/**
 * Skip precedence, highest first: approved_property → outreach_blocked → suppressed.
 * The first two only ever apply to an EXISTING property (a brand-new row can't already be
 * approved or blocked). Suppression is checked on the phone itself, so it applies to both new
 * and existing records.
 */
function classifySkipReason({ existing, rec, approvedPropertyIds, suppressionSet }) {
  if (existing && approvedPropertyIds.has(existing.id)) return 'approved_property'
  if (existing && existing.outreach_blocked) return 'outreach_blocked'
  // R4b: E.164-without-'+' form (phoneE164NoPlus), NOT the leading-zero form used above.
  const e164 = rec.phone ? phoneE164NoPlus(rec.phone) : null
  if (e164 && suppressionSet.has(e164)) return 'suppressed'
  return null
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2))

  // Structural dry-run guard: this script cannot write, full stop — see file header.
  if (!opts.dryRun) {
    console.error(
      'Only --dry-run is implemented by this script (live writes ship in a later task). Re-run with --dry-run.'
    )
    process.exit(1)
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE
  if (!supabaseUrl || !serviceRole) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE')
    process.exit(1)
  }
  const sb = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } })

  const now = new Date()
  const { records } = buildRenewalRecords({
    propertiesCsv: opts.propertiesCsv,
    movementsCsv: opts.movementsCsv,
    today: now.toISOString().slice(0, 10),
  })

  const [existingByExternalId, suppressionSet, approvedPropertyIds] = await Promise.all([
    loadExistingProperties(
      sb,
      opts.org,
      records.map((r) => r.externalId)
    ),
    loadSuppressionSet(sb, opts.org),
    loadApprovedPropertyIds(sb, opts.org),
  ])

  const plan = {
    propertiesToCreate: [],
    propertiesToUpdate: [],
    phoneFills: 0,
    phoneConflicts: 0,
    leadsPending: 0,
    leadsSkipped: { approved_property: 0, outreach_blocked: 0, suppressed: 0 },
  }
  // Per-record ledger — not required by the plan shape in the brief, but cheap to keep and
  // directly usable by Task 5 (the live-write task) instead of re-deriving classification.
  const leads = []

  for (const rec of records) {
    const existing = existingByExternalId.get(rec.externalId) || null

    if (existing) {
      const { patch, phoneFill, phoneConflict } = buildUpdatePatch(existing, rec, now)
      plan.propertiesToUpdate.push({ externalId: rec.externalId, propertyId: existing.id, patch })
      if (phoneFill) plan.phoneFills++
      if (phoneConflict) plan.phoneConflicts++
    } else {
      plan.propertiesToCreate.push(buildNewPropertyRow(opts.org, rec, now))
    }

    const skipReason = classifySkipReason({ existing, rec, approvedPropertyIds, suppressionSet })
    if (skipReason) {
      plan.leadsSkipped[skipReason]++
    } else {
      plan.leadsPending++
    }
    leads.push({ externalId: rec.externalId, propertyId: existing ? existing.id : null, status: skipReason ? 'skipped' : 'pending', skipReason })
  }

  const leadsTotal = records.length
  const skippedTotal = Object.values(plan.leadsSkipped).reduce((a, b) => a + b, 0)
  const createUpdateTotal = plan.propertiesToCreate.length + plan.propertiesToUpdate.length

  console.log('=== Renewal-leads import — DRY RUN ===')
  console.log(`org:            ${opts.org}`)
  console.log(`properties csv: ${opts.propertiesCsv}`)
  console.log(`movements csv:  ${opts.movementsCsv}`)
  console.log('')
  console.log(`records parsed:             ${records.length}`)
  console.log(`existing properties found:  ${existingByExternalId.size}`)
  console.log(`suppression numbers (org):  ${suppressionSet.size}`)
  console.log(`approved properties (org):  ${approvedPropertyIds.size}`)
  console.log('')
  console.log('--- Plan ---')
  console.log(`properties to create: ${plan.propertiesToCreate.length}`)
  console.log(`properties to update: ${plan.propertiesToUpdate.length}`)
  console.log(`phone fills:          ${plan.phoneFills}`)
  console.log(`phone conflicts:      ${plan.phoneConflicts}`)
  console.log(`leads total:          ${leadsTotal}`)
  console.log(`leads pending:        ${plan.leadsPending}`)
  console.log('leads skipped:')
  console.log(`  approved_property: ${plan.leadsSkipped.approved_property}`)
  console.log(`  outreach_blocked:  ${plan.leadsSkipped.outreach_blocked}`)
  console.log(`  suppressed:        ${plan.leadsSkipped.suppressed}`)
  console.log('')
  console.log('--- Sanity checks ---')
  console.log(
    `create + update = ${createUpdateTotal} (== records parsed ${records.length}: ${createUpdateTotal === records.length})`
  )
  console.log(
    `pending + skipped = ${plan.leadsPending + skippedTotal} (== records parsed ${records.length}: ${
      plan.leadsPending + skippedTotal === records.length
    })`
  )
  console.log('')
  console.log('No writes performed (dry run) — this script has no write code path yet.')

  return { plan, leads }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
