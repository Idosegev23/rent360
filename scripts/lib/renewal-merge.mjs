/**
 * Pure CSV merge + lead-scoring for the renewal-leads campaign.
 *
 * Takes the two Nadlan One historical exports (a `properties` snapshot and a `movements` log,
 * both flat CSV with a UTF-8 BOM and RFC4180-style `""`-escaped quoted fields — no embedded
 * newlines) and merges them into scored lead records.
 *
 * No DB access, no network, no env vars. This isolation is intentional: the module is runnable
 * and checkable entirely on its own (see the brief for the `node -e` verification snippet).
 *
 * Run standalone:
 *   node -e "
 *   import('./scripts/lib/renewal-merge.mjs').then(async m => {
 *     const { records, stats } = m.buildRenewalRecords({
 *       propertiesCsv: 'docs/wehouse_haifa_properties.csv',
 *       movementsCsv:  'docs/wehouse_haifa_movements.csv',
 *       today: '2026-09-01',
 *     })
 *     console.log(JSON.stringify(stats, null, 2))
 *   })
 *   "
 */
import fs from 'node:fs'

// ---------------------------------------------------------------------------
// Minimal quoted-CSV reader. Fields contain commas, ₪, and ' | '-separated
// lists, but no embedded newlines, so a line-oriented reader with quote
// handling is sufficient — no CSV dependency needed.
// ---------------------------------------------------------------------------

function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out
}

function readCsvRows(path) {
  let text = fs.readFileSync(path, 'utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // strip UTF-8 BOM
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length === 0) return []
  const header = parseCsvLine(lines[0])
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line)
    const row = {}
    header.forEach((key, i) => {
      row[key] = fields[i] ?? ''
    })
    return row
  })
}

// ---------------------------------------------------------------------------
// Field-level parsing helpers
// ---------------------------------------------------------------------------

// Phones: the column may hold two numbers separated by ' | '.
export function parsePhones(raw) {
  const out = []
  for (const part of String(raw || '').split('|')) {
    let n = part.replace(/\D/g, '')
    if (n.startsWith('972')) n = '0' + n.slice(3)
    if (n) out.push(n)
  }
  return out
}

const MOBILE_RE = /^0(5[0-8])/
export function phoneKind(nums) {
  if (nums.some((n) => MOBILE_RE.test(n))) return 'mobile'
  if (nums.some((n) => n.startsWith('073') || n.startsWith('077') || n.startsWith('072'))) return 'voip'
  return 'landline'
}

// Amenity letters → Hebrew names.
const AMENITY = { E: 'מעלית', P: 'חניה', B: 'מרפסת', S: 'מחסן', M: 'ממ"ד', F: 'מרוהט' }
export function parseAmenities(raw) {
  const out = []
  for (const ch of String(raw || '')) {
    if (AMENITY[ch]) out.push(AMENITY[ch])
  }
  return out
}

function nullIfEmpty(raw) {
  const s = String(raw ?? '').trim()
  return s === '' ? null : s
}

function parseNumOrNull(raw) {
  const s = String(raw ?? '').trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// Prices like "5,600 ₪" or the placeholder "--".
function parsePrice(raw) {
  const digits = String(raw ?? '').replace(/[^\d]/g, '')
  return digits ? Number(digits) : null
}

function parsePipeList(raw) {
  return String(raw ?? '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Movements
// ---------------------------------------------------------------------------

function readMovementsByProperty(path) {
  const rows = readCsvRows(path)
  const byId = new Map()
  for (const r of rows) {
    const id = r['מספר_נכס']
    const entry = {
      date: r['תאריך'],
      action: r['פעולה'],
      code: r['קוד'],
      description: r['תיאור'],
    }
    if (!byId.has(id)) byId.set(id, [])
    byId.get(id).push(entry)
  }
  // Sort each property's movements ascending by date. Array#sort is stable, so
  // movements sharing an identical timestamp (the export has plenty) keep
  // their original file order.
  for (const list of byId.values()) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  }
  return byId
}

// "פורסם ביד2. מחיר 5,600 ₪." → 5600. A quoted price of 0 is a scrape
// placeholder ("no price yet"), not a real free listing — treat as unknown.
const PRICE_RE = /(\d[\d,]*)\s*₪/
function extractPrice(description) {
  const m = PRICE_RE.exec(String(description || ''))
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  return n === 0 ? null : n
}

// "המחיר שונה מ 3,500 ₪ ל 5,700 ₪." → the target (new) price, after 'ל'.
const PRICE_TO_RE = /ל\s*(\d[\d,]*)\s*₪/
function extractTargetPrice(description) {
  const m = PRICE_TO_RE.exec(String(description || ''))
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  return n === 0 ? null : n
}

// priceFirst: the מחיר in the earliest code-216 row, or the target price of
// the earliest code-217. "Earliest" scans the sorted (ties in file order)
// movement list front-to-back and resolves on the first 216-or-217 it finds
// — a 217 tied with (or preceding) the property's own 216 wins, since it
// reflects the settled price at that instant. When that first event's price
// is the 0-placeholder, priceFirst is unknown (null) even if a later, valid
// price change exists — it does not keep scanning past it.
function computePriceFirst(movements) {
  for (const m of movements) {
    if (m.code === '216') return extractPrice(m.description)
    if (m.code === '217') return extractTargetPrice(m.description)
  }
  return null
}

// delistedObservedAt: the תאריך of the LAST code-218 movement.
function computeDelist(movements) {
  const delists = movements.filter((m) => m.code === '218')
  if (!delists.length) return { delistedObservedAt: null, delistedAt: null }
  const last = delists[delists.length - 1]
  return { delistedObservedAt: last.date, delistedAt: last.date.slice(0, 10) }
}

// maturesAt = delistedAt + 365 days, computed here — never trust the source's
// own תאריך_הפיכה_לליד column.
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Exact-integer round-half-to-even division: returns round(num / den) as an
// integer, breaking exact .5 ties toward the even result. Used for
// priceChangePct so that e.g. exactly-6.25% resolves to 6.2 (not 6.3 via
// plain Math.round, which always breaks ties upward) — floating point on
// priceLast/priceFirst (both integers) would otherwise make the tie-detection
// itself unreliable, so this works in scaled integers throughout.
function divRoundHalfEven(num, den) {
  const sign = num < 0 !== den < 0 ? -1 : 1
  const n = Math.abs(num)
  const d = Math.abs(den)
  const q = Math.floor(n / d)
  const twiceRemainder = 2 * (n - q * d)
  let result
  if (twiceRemainder < d) result = q
  else if (twiceRemainder > d) result = q + 1
  else result = q % 2 === 0 ? q : q + 1 // exact half: round to even
  return sign * result
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function scoreRecord(r, phoneFreq) {
  let s = 0
  if (r.phones.length && r.phones.every((n) => phoneFreq.get(n) === 1)) s += 30 // private owner
  if (r.phones.some((n) => MOBILE_RE.test(n))) s += 20 // real mobile
  if (r.timesListed >= 2) s += 20 // recurring churn
  if (r.daysOnMarket != null && r.daysOnMarket <= 60) s += 15 // rented fast
  else if (r.daysOnMarket != null && r.daysOnMarket > 180) s += 5
  if (r.priceChangePct != null && r.priceChangePct <= -3) s += 10 // had to cut price
  if (r.neighborhood) s += 5
  return s
}

// Grade boundaries (80/60/40) are duplicated in three other places that cannot share code across
// JS/TSX/SQL — keep all four in sync when changing these numbers: lib/outreach/renewal-shared.ts
// (`gradeScoreRange`), components/renewals/RenewalQueue.tsx (`gradeForScore`), and the CASE in
// supabase/migrations/0039_renewal_leads_aggregates_rpc.sql.
function gradeFor(score) {
  if (score >= 80) return 'A'
  if (score >= 60) return 'B'
  if (score >= 40) return 'C'
  return 'D'
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function buildRenewalRecords({ propertiesCsv, movementsCsv, today }) {
  const propertyRows = readCsvRows(propertiesCsv)
  const movementsByProperty = readMovementsByProperty(movementsCsv)

  // Pass 1: parse phones for every row and build a global phone-frequency map.
  // A number is "private" only when every number on that listing appears
  // exactly once across the whole export.
  const phoneFreq = new Map()
  const withPhones = propertyRows.map((row) => {
    const externalId = row['מספר_נכס']
    const phones = parsePhones(row['טלפון'])
    for (const n of phones) phoneFreq.set(n, (phoneFreq.get(n) || 0) + 1)
    return { row, externalId, phones }
  })

  // Pass 2: merge each property with its movements and score it.
  const records = withPhones.map(({ row, externalId, phones }) => {
    const movements = movementsByProperty.get(externalId) || []

    const priceFirst = computePriceFirst(movements)
    const priceLast = parsePrice(row['מחיר_אחרון'])
    let priceChangePct = null
    if (priceFirst != null && priceLast != null && priceFirst !== 0) {
      // (priceLast - priceFirst) / priceFirst * 100, rounded to 1 decimal — done in
      // scaled integers (num/den = pct*10) so the round-half-to-even tie-break is exact.
      priceChangePct = divRoundHalfEven((priceLast - priceFirst) * 1000, priceFirst) / 10
    }

    const { delistedObservedAt, delistedAt } = computeDelist(movements)
    const baseDelistedAt = delistedAt || today || null
    const maturesAt = baseDelistedAt ? addDays(baseDelistedAt, 365) : null

    const timesListed = parseNumOrNull(row['מספר_פעמים_פורסם']) ?? 0
    const daysOnMarket = parseNumOrNull(row['ימים_בפרסום'])
    const priceChanges = parseNumOrNull(row['מספר_שינויי_מחיר']) ?? 0
    const neighborhood = nullIfEmpty(row['שכונה'])

    const scoreInput = { phones, timesListed, daysOnMarket, priceChangePct, neighborhood }
    const score = scoreRecord(scoreInput, phoneFreq)

    return {
      externalId,
      city: nullIfEmpty(row['עיר']),
      neighborhood,
      street: nullIfEmpty(row['רחוב']),
      kind: nullIfEmpty(row['סוג']),
      rooms: parseNumOrNull(row['חדרים']),
      sqm: parseNumOrNull(row['בנוי_מר']),
      floor: parseNumOrNull(row['קומה']),
      priceFirst,
      priceLast,
      priceChangePct,
      amenities: parseAmenities(row['תוספות']),
      contactName: nullIfEmpty(row['איש_קשר']),
      phone: phones[0] || null,
      phoneAlt: phones[1] || null,
      phoneKind: phoneKind(phones),
      isPrivateOwner: phones.length > 0 && phones.every((n) => phoneFreq.get(n) === 1),
      firstListedAt: nullIfEmpty(row['תאריך_פרסום_ראשון']),
      delistedAt,
      delistedObservedAt,
      maturesAt,
      daysOnMarket,
      timesListed,
      priceChanges,
      segment: timesListed >= 2 ? 'repeat' : 'private_once',
      score,
      images: parsePipeList(row['קישורי_תמונות']),
      timeline: movements.map((m) => ({ date: m.date, action: m.action, code: m.code, description: m.description })),
    }
  })

  const stats = {
    total: records.length,
    withPhone: records.filter((r) => r.phone).length,
    withDelistDate: records.filter((r) => r.delistedAt).length,
    privateOwners: records.filter((r) => r.isPrivateOwner).length,
    mobile: records.filter((r) => r.phoneKind === 'mobile').length,
    repeat: records.filter((r) => r.segment === 'repeat').length,
    bySegment: {},
    byGrade: {},
    byCity: {},
  }
  for (const r of records) {
    stats.bySegment[r.segment] = (stats.bySegment[r.segment] || 0) + 1
    const grade = gradeFor(r.score)
    stats.byGrade[grade] = (stats.byGrade[grade] || 0) + 1
    const city = r.city || 'לא ידוע'
    stats.byCity[city] = (stats.byCity[city] || 0) + 1
  }

  return { records, stats }
}
