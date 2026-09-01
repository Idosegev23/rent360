/**
 * Renewal-leads import — Task 5: read + plan + LIVE WRITE phase.
 *
 * Task 4 built the read/plan/classify phase with no write code path at all. This build adds the
 * write phase: `properties` upsert (create + update, in chunks) and `renewal_leads` upsert (in
 * chunks), plus a wide pre-write snapshot (for undo) and a narrow post-write verification (that
 * the 8 protected columns were never touched). `--dry-run` still does exactly what it did in
 * Task 4 — classify and print, no writes — and can be combined with `--snapshot` to capture the
 * pre-write state without writing anything. Omitting `--dry-run` now performs the live write.
 *
 * Run (dry run + snapshot):
 *   set -a; . ./.env.local; set +a; NODE_PATH="$(pwd)/node_modules" \
 *     node scripts/import-renewal-leads.mjs \
 *       --properties docs/wehouse_haifa_properties.csv \
 *       --movements  docs/wehouse_haifa_movements.csv \
 *       --dry-run --snapshot /tmp/pre-import.json
 *
 * Run (live write):
 *   set -a; . ./.env.local; set +a; NODE_PATH="$(pwd)/node_modules" \
 *     node scripts/import-renewal-leads.mjs \
 *       --properties docs/wehouse_haifa_properties.csv \
 *       --movements  docs/wehouse_haifa_movements.csv \
 *       --snapshot /tmp/pre-import.json
 *
 * Run (verify no protected column drifted):
 *   set -a; . ./.env.local; set +a; NODE_PATH="$(pwd)/node_modules" \
 *     node scripts/import-renewal-leads.mjs --verify-snapshot /tmp/pre-import.json
 *
 * ---------------------------------------------------------------------------------------------
 * Known-defect rulings applied here (see task-4-brief.md / task-5-brief.md for the original,
 * unpatched text):
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
 * R11 — `--snapshot` captures a WIDE column set, not just the 8 protected columns: it also
 *      captures every column `buildUpdatePatch` can write (contact_phone, contact_name,
 *      neighborhood, street, sqm, floor, rooms, price, type, timeline, scraped_metadata) so the
 *      merge is undoable. `--verify-snapshot` still only diffs the 8 PROTECTED columns — those
 *      must read back identical (0 differences); the wide columns are captured for rollback, not
 *      for a zero-diff assertion, since the import deliberately changes many of them.
 * R4  (task 5) — see `classifySkipReason` below: no change needed there (already right per task 4
 *      report), noted here only because the controller flagged the brief's own SQL assertion #4
 *      as vacuous (phone forms never compared correctly) — that's a query fix at assertion time,
 *      not a code fix.
 * ---------------------------------------------------------------------------------------------
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { buildRenewalRecords, parsePhones } from './lib/renewal-merge.mjs'

const DEFAULT_ORG = '11111111-1111-1111-1111-111111111111'
const CHUNK_SIZE = 200 // Supabase .in() over ~13k ids must be chunked or the URL blows the length limit.
const PROPERTIES_UPSERT_CHUNK = 200
const RENEWAL_LEADS_UPSERT_CHUNK = 500

// The 8 columns that must NEVER be written on the existing-row (update) path.
const PROTECTED_COLUMNS = [
  'initial_message_sent',
  'outreach_blocked',
  'is_active',
  'landlord_id',
  'assigned_agent_user_id',
  'agreed_commission_months',
  'agreed_commission_amount',
  'status',
]

// R11: every column `buildUpdatePatch` can write, captured in the snapshot (for undo) even
// though `--verify-snapshot` only asserts zero-diff on PROTECTED_COLUMNS above.
const WIDE_SNAPSHOT_COLUMNS = [
  'contact_phone',
  'contact_name',
  'neighborhood',
  'street',
  'sqm',
  'floor',
  'rooms',
  'price',
  'type',
  'timeline',
  'scraped_metadata',
]

const SNAPSHOT_SELECT = ['id', 'external_id', ...PROTECTED_COLUMNS, ...WIDE_SNAPSHOT_COLUMNS].join(', ')
const VERIFY_SELECT = ['id', 'external_id', ...PROTECTED_COLUMNS].join(', ')

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
    else if (a === '--snapshot') opts.snapshotPath = argv[++i]
    else if (a === '--verify-snapshot') opts.verifySnapshotPath = argv[++i]
    else {
      console.error(`Unknown argument: ${a}`)
      process.exit(1)
    }
  }
  // --verify-snapshot is a standalone mode: it never touches the CSVs, so they're not required.
  if (opts.verifySnapshotPath) return opts
  if (!opts.propertiesCsv || !opts.movementsCsv) {
    console.error(
      'Usage: node scripts/import-renewal-leads.mjs --properties <csv> --movements <csv> [--org <uuid>] [--dry-run] [--snapshot <path>]\n' +
        '   or: node scripts/import-renewal-leads.mjs --verify-snapshot <path>'
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
      // title/city included so normalizeUpdateRow can pass them through unchanged: both are
      // NOT NULL with no DEFAULT, and PostgREST's upsert validates NOT NULL against the
      // candidate INSERT row even when it will resolve via ON CONFLICT DO UPDATE — omitting
      // either one fails the whole update, confirmed live (see normalizeUpdateRow's docstring).
      .select(
        'id, external_id, title, city, contact_phone, contact_name, neighborhood, street, sqm, floor, rooms, price, outreach_blocked, scraped_metadata'
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
// Snapshot (R11) — wide capture for undo, narrow verification for the invariant.
// ---------------------------------------------------------------------------

/** Wide snapshot rows (id, external_id, 8 protected + 11 writable columns) for the given ids. */
async function loadSnapshotRows(sb, orgId, propertyIds) {
  const uniqueIds = Array.from(new Set(propertyIds.filter(Boolean)))
  const out = []
  for (const slice of chunk(uniqueIds, CHUNK_SIZE)) {
    const { data, error } = await sb.from('properties').select(SNAPSHOT_SELECT).eq('org_id', orgId).in('id', slice)
    if (error) throw new Error(`snapshot lookup failed: ${error.message}`)
    out.push(...(data || []))
  }
  return out
}

/**
 * Fail loudly (exit 1) if the snapshot cannot be written — per R11, the caller must never
 * proceed to the write phase without a snapshot on disk.
 */
function writeSnapshotFileOrDie(path, rows) {
  try {
    fs.writeFileSync(path, JSON.stringify(rows, null, 2))
  } catch (err) {
    console.error(`FATAL: could not write snapshot file to ${path}: ${err.message || err}`)
    console.error('Refusing to proceed — a snapshot must be on disk before any write.')
    process.exit(1)
  }
}

/**
 * --verify-snapshot mode: re-read the same ids from the snapshot file and diff ONLY the 8
 * PROTECTED_COLUMNS against the live DB. The wide (writable) columns captured by R11 are for
 * undo purposes and are NOT diffed here — the import deliberately changes many of them, so a
 * zero-diff assertion on those would be wrong by construction. Any difference on a protected
 * column is a bug in buildUpdatePatch (or in something else writing to `properties`).
 */
async function runVerifySnapshot(sb, orgId, path) {
  let entries
  try {
    entries = JSON.parse(fs.readFileSync(path, 'utf8'))
  } catch (err) {
    console.error(`FATAL: could not read snapshot file ${path}: ${err.message || err}`)
    process.exit(1)
  }
  console.log(`=== Verify snapshot: ${path} (${entries.length} entries) ===`)

  const byId = new Map(entries.map((e) => [e.id, e]))
  const ids = Array.from(byId.keys())
  const current = []
  for (const slice of chunk(ids, CHUNK_SIZE)) {
    const { data, error } = await sb.from('properties').select(VERIFY_SELECT).eq('org_id', orgId).in('id', slice)
    if (error) throw new Error(`verify-snapshot lookup failed: ${error.message}`)
    current.push(...(data || []))
  }
  const currentById = new Map(current.map((r) => [r.id, r]))

  let diffCount = 0
  const details = []
  for (const [id, before] of byId) {
    const now = currentById.get(id)
    if (!now) {
      diffCount++
      details.push(`${id} (${before.external_id}): row no longer found in properties`)
      continue
    }
    for (const col of PROTECTED_COLUMNS) {
      if (before[col] !== now[col]) {
        diffCount++
        details.push(`${id} (${before.external_id}): ${col} changed ${JSON.stringify(before[col])} -> ${JSON.stringify(now[col])}`)
      }
    }
  }

  if (details.length) {
    console.log('--- Differences ---')
    for (const line of details.slice(0, 50)) console.log(line)
    if (details.length > 50) console.log(`... and ${details.length - 50} more`)
  }
  console.log(`${diffCount} differences across ${entries.length} properties`)
  return diffCount
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
 * Turns a (possibly partial) `buildUpdatePatch` patch into a FULL, fixed-shape row for the
 * live upsert. This is deliberate and load-bearing: `patch` objects have a VARIABLE key set
 * (e.g. `neighborhood` is only present when it's being filled), and a bulk `.upsert()` call
 * derives its PostgREST `columns=` list from the UNION of keys across every row in the batch —
 * a row missing a key that another row in the same chunk has would otherwise get that column
 * defaulted (potentially to NULL), silently clobbering real data. Normalizing every row to the
 * SAME fixed key set (falling back to `existing`'s current value when the patch doesn't touch a
 * field) makes that failure mode structurally impossible, independent of PostgREST/Supabase-js
 * `defaultToNull` semantics. Protected columns are never keys here at all, on any row, so they
 * are never part of the update statement's column list — not merely left unchanged by value.
 *
 * `org_id`, `title`, `city` are ALWAYS included, unconditionally passed through from `existing`,
 * even though the update path never intends to change any of them: PostgREST's upsert always
 * compiles to `INSERT ... ON CONFLICT (external_id) DO UPDATE SET <listed columns>`, and Postgres
 * validates NOT NULL constraints against the candidate INSERT row itself before it even resolves
 * the conflict — a NOT-NULL-no-DEFAULT column omitted from the row's key set fails that check
 * even though the statement was always going to take the DO UPDATE branch. `properties` has
 * exactly three such columns (`org_id`, `title`, `city` — confirmed live via
 * information_schema), and omitting any one of them fails EVERY update row, not just rows that
 * happen to lack a value. Confirmed live, in order: omitting `org_id` failed all 9,338 update
 * rows ("null value in column org_id"); after adding it, omitting `title`/`city` failed all
 * 13,463 ("null value in column title"). Both are pure no-ops here (existing's own current
 * value, unchanged) — they exist only to satisfy the NOT NULL check on the candidate row.
 */
function normalizeUpdateRow(existing, patch, orgId) {
  const pick = (key) => (key in patch ? patch[key] : existing[key])
  return {
    org_id: orgId,
    external_id: existing.external_id,
    title: existing.title,
    city: existing.city,
    contact_phone: pick('contact_phone'),
    contact_name: pick('contact_name'),
    neighborhood: pick('neighborhood'),
    street: pick('street'),
    sqm: pick('sqm'),
    floor: pick('floor'),
    rooms: pick('rooms'),
    price: pick('price'),
    timeline: patch.timeline, // buildUpdatePatch always sets this
    scraped_metadata: patch.scraped_metadata, // buildUpdatePatch always sets this
  }
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
// Write phase (Task 5). Every chunk is wrapped in try/catch — a partial import must be visible
// (printed, with the first error of any failing chunk), never silent.
// ---------------------------------------------------------------------------

/**
 * Upserts `propertiesToCreate` (full new-property rows, uniform shape already) and
 * `propertiesToUpdate` (normalized to a uniform shape via `normalizeUpdateRow`) as TWO SEPARATE
 * upsert calls, deliberately never mixed in one batch — mixing create-shaped rows (which carry
 * `is_active`, `source`, etc.) with update-shaped rows would pull those extra columns into the
 * update statement's column list too. `onConflict: 'external_id'` per the brief:
 * `properties_external_id_unique` is a GLOBAL unique index (confirmed live), not per-org.
 *
 * Returns { propertyIdByExternalId, createOk, createFailed, updateOk, updateFailed }.
 */
async function writeProperties(sb, plan, existingByExternalId, orgId) {
  const propertyIdByExternalId = new Map()
  for (const [externalId, row] of existingByExternalId) propertyIdByExternalId.set(externalId, row.id)

  let createOk = 0
  let createFailed = 0
  const createChunks = chunk(plan.propertiesToCreate, PROPERTIES_UPSERT_CHUNK)
  for (let i = 0; i < createChunks.length; i++) {
    const rows = createChunks[i]
    try {
      const { data, error } = await sb
        .from('properties')
        .upsert(rows, { onConflict: 'external_id' })
        .select('id, external_id')
      if (error) throw error
      for (const row of data || []) propertyIdByExternalId.set(row.external_id, row.id)
      createOk += rows.length
    } catch (err) {
      createFailed += rows.length
      console.error(
        `[properties CREATE chunk ${i + 1}/${createChunks.length}] FAILED (${rows.length} rows) — first error: ${err.message || err}`
      )
    }
  }

  let updateOk = 0
  let updateFailed = 0
  const updateChunks = chunk(plan.propertiesToUpdate, PROPERTIES_UPSERT_CHUNK)
  for (let i = 0; i < updateChunks.length; i++) {
    const slice = updateChunks[i]
    const rows = slice.map((u) => normalizeUpdateRow(existingByExternalId.get(u.externalId), u.patch, orgId))
    try {
      const { error } = await sb.from('properties').upsert(rows, { onConflict: 'external_id' })
      if (error) throw error
      updateOk += rows.length
    } catch (err) {
      updateFailed += rows.length
      console.error(
        `[properties UPDATE chunk ${i + 1}/${updateChunks.length}] FAILED (${rows.length} rows) — first error: ${err.message || err}`
      )
    }
  }

  return { propertyIdByExternalId, createOk, createFailed, updateOk, updateFailed }
}

// renewal_leads.price_change_pct is numeric(5,1) — max representable magnitude is 999.9. The
// source export has 13/13463 records where an implausible price_first (a data-entry artifact,
// e.g. ₪100/₪150 placeholder) makes the computed pct explode (seen live up to 41297.8%). This is
// a display/analytics-only derived field — price_first and price_last (the real numbers this was
// computed from) are stored as-is in their own `integer` columns regardless, so nothing is lost
// by nulling an unrepresentable derived percentage rather than truncating it into a false value.
const PRICE_CHANGE_PCT_MAX = 999.9
function clampPriceChangePct(pct) {
  if (pct == null) return null
  return Math.abs(pct) <= PRICE_CHANGE_PCT_MAX ? pct : null
}

/** Builds the full `renewal_leads` insert row for one classified record. */
function buildRenewalLeadRow(orgId, rec, lead) {
  return {
    org_id: orgId,
    property_id: lead.propertyId,
    source: 'nadlanone',
    external_id: rec.externalId,
    delisted_at: rec.delistedAt,
    delisted_observed_at: rec.delistedObservedAt,
    first_listed_at: rec.firstListedAt,
    matures_at: rec.maturesAt,
    days_on_market: rec.daysOnMarket,
    times_listed: rec.timesListed,
    price_first: rec.priceFirst,
    price_last: rec.priceLast,
    price_change_pct: clampPriceChangePct(rec.priceChangePct),
    city: rec.city,
    street: rec.street,
    segment: rec.segment,
    score: rec.score,
    is_private_owner: rec.isPrivateOwner,
    phone_kind: rec.phoneKind,
    phone_alt: rec.phoneAlt,
    status: lead.status,
    skip_reason: lead.skipReason,
    timeline: rec.timeline,
  }
}

/**
 * Idempotent insert: `.upsert(..., { onConflict: 'org_id,external_id', ignoreDuplicates: true })`
 * so re-running is a no-op (skips rows that already exist) rather than a 23505 crash.
 */
async function writeRenewalLeads(sb, rows) {
  let ok = 0
  let failed = 0
  const chunks = chunk(rows, RENEWAL_LEADS_UPSERT_CHUNK)
  for (let i = 0; i < chunks.length; i++) {
    const slice = chunks[i]
    try {
      const { error } = await sb
        .from('renewal_leads')
        .upsert(slice, { onConflict: 'org_id,external_id', ignoreDuplicates: true })
      if (error) throw error
      ok += slice.length
    } catch (err) {
      failed += slice.length
      console.error(
        `[renewal_leads chunk ${i + 1}/${chunks.length}] FAILED (${slice.length} rows) — first error: ${err.message || err}`
      )
    }
  }
  return { ok, failed }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2))

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE
  if (!supabaseUrl || !serviceRole) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE')
    process.exit(1)
  }
  const sb = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } })

  // Standalone mode: verify the 8 protected columns never drifted, then exit. No CSVs, no plan.
  if (opts.verifySnapshotPath) {
    const diffCount = await runVerifySnapshot(sb, opts.org, opts.verifySnapshotPath)
    if (diffCount > 0) process.exitCode = 1
    return
  }

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

  console.log(`=== Renewal-leads import — ${opts.dryRun ? 'DRY RUN' : 'LIVE'} ===`)
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

  // --snapshot: write the wide (R11) pre-write snapshot for the rows about to be updated. Valid
  // in both dry-run (Step 1's usage) and live mode — in live mode this IS the pre-write
  // snapshot as long as it runs before the write phase below, which it does.
  if (opts.snapshotPath) {
    const snapshotRows = await loadSnapshotRows(
      sb,
      opts.org,
      plan.propertiesToUpdate.map((u) => u.propertyId)
    )
    writeSnapshotFileOrDie(opts.snapshotPath, snapshotRows)
    console.log(`snapshot written: ${snapshotRows.length} entries -> ${opts.snapshotPath}`)
    console.log('')
  }

  if (opts.dryRun) {
    console.log('No writes performed (dry run).')
    return { plan, leads }
  }

  // R11 safety net: never enter the write phase without a snapshot on disk, even if the caller
  // forgot --snapshot. If --snapshot was already passed above, this is a no-op guard only.
  if (!opts.snapshotPath) {
    const autoPath = `/tmp/renewal-import-snapshot-${Date.now()}.json`
    const snapshotRows = await loadSnapshotRows(
      sb,
      opts.org,
      plan.propertiesToUpdate.map((u) => u.propertyId)
    )
    writeSnapshotFileOrDie(autoPath, snapshotRows)
    console.log(`auto-snapshot written (no --snapshot passed): ${snapshotRows.length} entries -> ${autoPath}`)
    console.log('')
  }

  console.log('--- Write phase ---')
  const { propertyIdByExternalId, createOk, createFailed, updateOk, updateFailed } = await writeProperties(
    sb,
    plan,
    existingByExternalId,
    opts.org
  )
  console.log(`properties created: ${createOk} ok, ${createFailed} failed`)
  console.log(`properties updated: ${updateOk} ok, ${updateFailed} failed`)

  // Backfill property_id for create-path leads from the upsert response.
  for (const lead of leads) {
    if (lead.propertyId == null) lead.propertyId = propertyIdByExternalId.get(lead.externalId) || null
  }
  const unresolvable = leads.filter((l) => l.propertyId == null)
  if (unresolvable.length) {
    console.error(
      `WARNING: ${unresolvable.length} lead(s) have no resolved property_id (their property upsert chunk failed) — excluded from the renewal_leads write.`
    )
  }

  const recordsByExternalId = new Map(records.map((r) => [r.externalId, r]))
  const leadRows = leads
    .filter((l) => l.propertyId != null)
    .map((l) => buildRenewalLeadRow(opts.org, recordsByExternalId.get(l.externalId), l))

  const { ok: leadsOk, failed: leadsFailed } = await writeRenewalLeads(sb, leadRows)
  console.log(`renewal_leads upserted: ${leadsOk} ok (attempted), ${leadsFailed} failed`)
  console.log('')

  const anyFailures = createFailed > 0 || updateFailed > 0 || leadsFailed > 0 || unresolvable.length > 0
  if (anyFailures) {
    console.error('*** PARTIAL IMPORT — see failed-chunk errors above. ***')
    process.exitCode = 1
  } else {
    console.log('Live write complete — all chunks succeeded.')
  }

  return { plan, leads }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
