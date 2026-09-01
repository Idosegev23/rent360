# Renewal Leads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Nadlan One Haifa/Krayot/Nesher export (13,463 delisted rentals with 100% phone and delist-date coverage) into a managed renewal-lead campaign: imported into the DB, browsable and sendable from a new `/renewals` page, dispatched through the existing WhatsApp outreach stack.

**Architecture:** `properties` stays the property entity (upsert on `external_id`, which is already the Nadlan One id) so the inbox and AI agent have something to talk about; a new `renewal_leads` table holds only campaign lifecycle. Maturity is a *date query* (`delisted_at + 365`), not a state machine — no cron, no drift. Sending reuses `dispatchInitialOutreach`'s entire supporting cast (suppression, governance caps, jitter, send-window, threads, messages) via a parallel `renewal-dispatcher`.

**Tech Stack:** Next.js 14 App Router · TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) · Supabase Postgres (service-role writes, manual `org_id` filtering) · Node ESM scripts (`.mjs`) · Meta WhatsApp Cloud API · Tailwind, Hebrew RTL.

**Spec:** `docs/superpowers/specs/2026-09-01-renewal-leads-design.md` — read it before Task 1. Every measured number this plan asserts comes from there.

## Global Constraints

- **There is no test runner.** `npm test` is a placeholder that exits with an error. Never write or run `jest`/`vitest`/`pytest` steps, and never claim tests pass. Verification in this plan is real: `--dry-run` output, SQL assertions through the Supabase MCP, `npm run build`, `npm run lint`, and HTTP calls against `npm run dev`.
- **Hebrew user-facing copy must be gender-neutral** — plural/neutral phrasing only, never masculine- or feminine-specific forms. Applies to UI strings, error messages, and WhatsApp template bodies.
- **Outbound sends only 09:00–21:00 Israel time, never Shabbat/חג.** Enforced by `canSendNow()` from `lib/time/send-window.ts`. Never bypass it in a batch path.
- **Multi-tenancy:** every query filters `org_id` explicitly. Service-role calls bypass RLS, so the filter is the only protection. Org for this work: `11111111-1111-1111-1111-111111111111`.
- **Path alias `@/*` → repo root.** Existing `app/api/v1/outreach/*` routes use relative imports (`../../../../../lib/...`); match the neighbouring files you are editing.
- **Never send a non-approved template.** Gate on `whatsapp_templates.status === 'approved'` exactly as `dispatchInitialOutreach` does.
- **Vercel deploys are manual** (`npx vercel --prod`). Do not deploy as part of any task.
- Source data lives at `docs/wehouse_haifa_properties.csv` and `docs/wehouse_haifa_movements.csv`. Both are gitignored (22MB) — never `git add` them.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0038_renewal_leads.sql` | The `renewal_leads` table, indexes, RLS. |
| `scripts/lib/renewal-merge.mjs` | **Pure**: two CSV paths → scored lead records. No DB, no network. Independently verifiable. |
| `scripts/import-renewal-leads.mjs` | DB side: upsert `properties`, insert `renewal_leads`, apply skip gates. `--dry-run` writes nothing. |
| `scripts/submit-renewal-templates.mjs` | Register both templates at Meta + `whatsapp_templates` rows. |
| `lib/outreach/renewal-templates.ts` | Template names + component builder. Keeps the dispatcher lean. |
| `lib/outreach/renewal-dispatcher.ts` | One send: gates → Meta → thread → message → stamp lead. |
| `app/api/v1/renewals/queue/route.ts` | Due-lead queue + cap counters. |
| `app/api/v1/renewals/pipeline/route.ts` | Server-paginated browse + aggregates. |
| `app/api/v1/renewals/send-batch/route.ts` | Capped, jittered batch send. |
| `app/api/v1/renewals/send-one/route.ts` | Single manual send, cap-free. |
| `app/api/v1/renewals/skip/route.ts` | Mark a lead skipped. |
| `app/renewals/page.tsx` | Shell + tab switch only. |
| `components/renewals/RenewalQueue.tsx` | The "מבשילים" review-and-send tab. |
| `components/renewals/RenewalPipeline.tsx` | The "הצנרת" browse tab. |
| `components/shell/Sidebar.tsx` (modify) | Nav entry + due-count badge. |

`app/outreach/page.tsx` is already 873 lines; the two new tabs are separate components from the start so `/renewals` does not repeat that.

---

### Task 1: Migration — `renewal_leads` table

**Files:**
- Create: `supabase/migrations/0038_renewal_leads.sql`

**Interfaces:**
- Produces: table `public.renewal_leads` with the columns used by every later task — `id, org_id, property_id, source, external_id, delisted_at, delisted_observed_at, first_listed_at, matures_at, days_on_market, times_listed, price_first, price_last, price_change_pct, city, street, segment, score, is_private_owner, phone_kind, phone_alt, status, skip_reason, sent_at, thread_id, message_id, timeline, created_at, updated_at`.

- [ ] **Step 1: Write the migration**

```sql
-- Renewal-lead campaign built on the Nadlan One historical export. `properties` stays the
-- property entity (upsert on external_id, which IS the Nadlan One id); this table holds only
-- campaign lifecycle so re-running a campaign never mutates property state.
-- Maturity is a date query (matures_at = delisted_at + 365), not a state machine.
CREATE TABLE IF NOT EXISTS public.renewal_leads (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL,
  property_id           uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  source                text NOT NULL DEFAULT 'nadlanone',
  external_id           text NOT NULL,

  delisted_at           date NOT NULL,
  -- Detection-sweep timestamp, NOT the real delist moment: 27,560 delist movements in the
  -- source share only 344 distinct timestamps (1,213 properties at 2025-11-16T00:23:10).
  -- The day is accurate to ~±1-2 days. Never present this as an exact time.
  delisted_observed_at  timestamptz,
  first_listed_at       date,
  matures_at            date NOT NULL,

  days_on_market        int,
  times_listed          int NOT NULL DEFAULT 1,
  price_first           int,
  price_last            int,
  price_change_pct      numeric(5,1),

  -- Snapshot of the listing at export time (immutable facts, not live property state) so the
  -- browse page filters/sorts 13k rows without a join.
  city                  text,
  street                text,
  segment               text NOT NULL,
  score                 int NOT NULL DEFAULT 0,
  is_private_owner      boolean NOT NULL DEFAULT true,
  phone_kind            text,
  phone_alt             text,

  -- v1 writes: pending | sent | skipped. Reserved for outcome tracking: replied | won | lost.
  status                text NOT NULL DEFAULT 'pending',
  skip_reason           text,
  sent_at               timestamptz,
  thread_id             uuid REFERENCES public.threads(id) ON DELETE SET NULL,
  message_id            uuid REFERENCES public.messages(id) ON DELETE SET NULL,

  timeline              jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.renewal_leads
    ADD CONSTRAINT renewal_leads_org_external_unique UNIQUE (org_id, external_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.renewal_leads
    ADD CONSTRAINT renewal_leads_segment_chk CHECK (segment IN ('private_once','repeat'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.renewal_leads
    ADD CONSTRAINT renewal_leads_status_chk
    CHECK (status IN ('pending','sent','skipped','replied','won','lost'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS renewal_leads_due_idx   ON public.renewal_leads (org_id, status, matures_at);
CREATE INDEX IF NOT EXISTS renewal_leads_score_idx ON public.renewal_leads (org_id, score DESC);
CREATE INDEX IF NOT EXISTS renewal_leads_city_idx  ON public.renewal_leads (org_id, city);
CREATE INDEX IF NOT EXISTS renewal_leads_prop_idx  ON public.renewal_leads (property_id);

ALTER TABLE public.renewal_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_all_renewal_leads ON public.renewal_leads;
CREATE POLICY org_all_renewal_leads ON public.renewal_leads
  FOR ALL USING (org_id = public.jwt_org_id()) WITH CHECK (org_id = public.jwt_org_id());
```

- [ ] **Step 2: Apply it**

Use the Supabase MCP `apply_migration` tool with name `0038_renewal_leads` and the SQL above. (Per the repo's memory convention, MCP is the path for DDL — not `supabase db push`.)

- [ ] **Step 3: Verify the table matches the spec**

Run via MCP `execute_sql`:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name='renewal_leads'
order by ordinal_position;
```

Expected: 29 columns, `org_id`/`property_id`/`delisted_at`/`matures_at`/`segment`/`score`/`status`/`is_private_owner`/`times_listed`/`source` all `NO` for nullable.

Then confirm the constraints and indexes exist:

```sql
select conname from pg_constraint where conrelid='public.renewal_leads'::regclass order by conname;
select indexname from pg_indexes where tablename='renewal_leads' order by indexname;
```

Expected constraints include `renewal_leads_org_external_unique`, `renewal_leads_segment_chk`, `renewal_leads_status_chk`. Expected indexes include the four `renewal_leads_*_idx`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0038_renewal_leads.sql
git commit -m "feat(renewals): renewal_leads table (migration 0038)"
```

---

### Task 2: Submit both WhatsApp templates to Meta

Do this **early and out of dependency order** — Meta approval is the long pole and nothing else waits on it. Everything downstream is built and shipped while these sit in `pending`; the dispatcher simply refuses to send until they flip.

**Files:**
- Create: `scripts/submit-renewal-templates.mjs`
- Reference (do not modify): `scripts/submit-escalation-template.mjs`

**Interfaces:**
- Produces: rows in `whatsapp_templates` named `landlord_renewal_private_v1` and `landlord_renewal_repeat_v1`, `language='he'`, `status='pending'`, with `param_names` `["first_name","street_city"]` and `["first_name","street_city","times_listed"]` respectively. `lib/outreach/renewal-templates.ts` (Task 5) depends on these exact names and param orders.

- [ ] **Step 1: Read the existing submission script**

Read `scripts/submit-escalation-template.mjs` in full. Copy its structure exactly: env-var reading, `META_API = 'https://graph.facebook.com/v23.0'`, the POST to `${META_API}/${waba}/message_templates`, the "already exists" re-sync branch, and the `whatsapp_templates` upsert. Do not invent a different shape.

- [ ] **Step 2: Write the script**

Two templates, both `CATEGORY: 'MARKETING'`, `LANGUAGE: 'he'`. Each has a `HEADER` of format `TEXT` with text `{{1}}` (the address), a `BODY`, and a `BUTTONS` component with one `QUICK_REPLY` labelled `להסיר אותי` — matching the approved `landlord_outreach_v3_*` templates so the existing `isHardOptOut()` regex in `lib/outreach/suppression.ts` catches the reply.

Private template body (`landlord_renewal_private_v1`):

```js
const PRIVATE_BODY =
  'היי {{1}} 👋\n\n' +
  'לפני כשנה הדירה שלכם ב{{2}} הייתה בפרסום להשכרה, ואז ירדה — כנראה כי מצאתם שוכרים. מקווים שהלך טוב.\n\n' +
  'אנחנו רנט 360, מתווכים באזור. אם השוכרים מתחלפים בתקופה הקרובה, נשמח לחסוך לכם את הסיבוב: ' +
  'שוכרים מסוננים, ליווי חוזה וביטחונות, ותשלום רק על עסקה שנסגרה.\n\n' +
  'שווה שיחה של 2 דקות?'

const PRIVATE_COMPONENTS = [
  { type: 'HEADER', format: 'TEXT', text: '{{1}}', example: { header_text: ['הרצל, חיפה'] } },
  { type: 'BODY', text: PRIVATE_BODY, example: { body_text: [['שרון', 'הרצל, חיפה']] } },
  { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'להסיר אותי' }] },
]
```

Repeat template body (`landlord_renewal_repeat_v1`):

```js
const REPEAT_BODY =
  'היי {{1}} 👋\n\n' +
  'הדירה שלכם ב{{2}} עברה כבר {{3}} סבבי פרסום להשכרה. אנחנו יודעים כמה הסיבוב הזה גוזל — ' +
  'מודעה, טלפונים, ביטולים, סינון.\n\n' +
  'אנחנו רנט 360, מתווכים באזור. אם מתקרב סבב נוסף, אנחנו לוקחים אותו עליכם: שוכרים מסוננים, ' +
  'ליווי חוזה וביטחונות, ותשלום רק על עסקה שנסגרה.\n\n' +
  'שווה שיחה של 2 דקות?'

const REPEAT_COMPONENTS = [
  { type: 'HEADER', format: 'TEXT', text: '{{1}}', example: { header_text: ['ויצמן, קרית מוצקין'] } },
  { type: 'BODY', text: REPEAT_BODY, example: { body_text: [['דנה', 'ויצמן, קרית מוצקין', '3']] } },
  { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'להסיר אותי' }] },
]
```

Loop over both, submit each, then upsert its `whatsapp_templates` row with `body_template` set to the body text and `param_names` as listed in Interfaces. Make it idempotent: if Meta returns an "already exists" error, skip the create and still write/refresh the DB row.

- [ ] **Step 3: Confirm the copy is gender-neutral before sending anything**

Re-read both bodies. Every verb and possessive must be plural/neutral: `שלכם`, `מצאתם`, `מתווכים`, `נשמח לחסוך לכם`, `לוקחים אותו עליכם`, `אנחנו יודעים`. There must be no `שלך`/`מצאת`/`תוכל`/`תוכלי` anywhere. Fix any that slipped in.

- [ ] **Step 4: Run the script**

```bash
set -a; . ./.env.local; set +a; NODE_PATH="$(pwd)/node_modules" node scripts/submit-renewal-templates.mjs
```

Expected: both templates report submitted (or already-exist), and two DB rows are written.

- [ ] **Step 5: Verify the DB rows**

Via MCP `execute_sql`:

```sql
select name, language, category, status, param_names
from whatsapp_templates
where name in ('landlord_renewal_private_v1','landlord_renewal_repeat_v1');
```

Expected: two rows, `language='he'`, `category='marketing'`, `status='pending'`, `param_names` exactly `["first_name","street_city"]` and `["first_name","street_city","times_listed"]`.

- [ ] **Step 6: Commit**

```bash
git add scripts/submit-renewal-templates.mjs
git commit -m "feat(renewals): submit landlord_renewal_{private,repeat}_v1 templates to Meta"
```

---

### Task 3: Pure merge + scoring module

**Files:**
- Create: `scripts/lib/renewal-merge.mjs`

**Interfaces:**
- Produces: `export function buildRenewalRecords({ propertiesCsv, movementsCsv, today })` → `{ records, stats }`.
  - Each `record`: `{ externalId, city, neighborhood, street, kind, rooms, sqm, floor, priceFirst, priceLast, priceChangePct, amenities, contactName, phone, phoneAlt, phoneKind, isPrivateOwner, firstListedAt, delistedAt, delistedObservedAt, maturesAt, daysOnMarket, timesListed, priceChanges, segment, score, images, timeline }`.
  - `stats`: `{ total, withPhone, withDelistDate, privateOwners, mobile, repeat, bySegment, byGrade, byCity }`.
  - Dates are `YYYY-MM-DD` strings; `delistedObservedAt` is the raw ISO string from the movements file.
- Consumes: nothing. **No DB access, no network** — this is why it is a separate file: it can be run and checked on its own.

- [ ] **Step 1: Write the module**

Parse both CSVs with `node:fs` + a minimal quoted-CSV reader (fields contain commas, `₪`, and pipe-separated lists; there are no embedded newlines). Strip the UTF-8 BOM from the header line.

Key transformations, which must reproduce `docs/haifa_unified.csv` exactly:

```js
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
  if (nums.some(n => MOBILE_RE.test(n))) return 'mobile'
  if (nums.some(n => n.startsWith('073') || n.startsWith('077') || n.startsWith('072'))) return 'voip'
  return 'landline'
}

// Amenity letters → Hebrew names.
const AMENITY = { E: 'מעלית', P: 'חניה', B: 'מרפסת', S: 'מחסן', M: 'ממ"ד', F: 'מרוהט' }
```

Build a global phone-frequency map across **all** rows first (a number is "private" only when every number on that listing appears exactly once in the whole export), then score:

```js
export function scoreRecord(r, phoneFreq) {
  let s = 0
  if (r.phones.length && r.phones.every(n => phoneFreq.get(n) === 1)) s += 30  // private owner
  if (r.phones.some(n => MOBILE_RE.test(n))) s += 20                            // real mobile
  if (r.timesListed >= 2) s += 20                                               // recurring churn
  if (r.daysOnMarket != null && r.daysOnMarket <= 60) s += 15                   // rented fast
  else if (r.daysOnMarket != null && r.daysOnMarket > 180) s += 5
  if (r.priceChangePct != null && r.priceChangePct <= -3) s += 10               // had to cut price
  if (r.neighborhood) s += 5
  return s
}
```

`priceFirst` comes from the movements: the `מחיר` in the earliest code-`216` row, or the target price of the earliest code-`217`. `priceChangePct = round((priceLast - priceFirst) / priceFirst * 100, 1)`.

`delistedObservedAt` = the `תאריך` of the **last** code-`218` movement for that property. `delistedAt` = its first 10 characters. `maturesAt` = `delistedAt + 365 days`.

`segment = timesListed >= 2 ? 'repeat' : 'private_once'`.

`timeline` = the property's full movement list as `[{ date, action, code, description }]`, sorted ascending.

- [ ] **Step 2: Run it standalone and check the numbers against the spec**

```bash
node -e "
import('./scripts/lib/renewal-merge.mjs').then(async m => {
  const { records, stats } = m.buildRenewalRecords({
    propertiesCsv: 'docs/wehouse_haifa_properties.csv',
    movementsCsv:  'docs/wehouse_haifa_movements.csv',
    today: '2026-09-01',
  })
  console.log(JSON.stringify(stats, null, 2))
  console.log('sample:', JSON.stringify(records[0], null, 2))
})
"
```

Expected, matching the spec's Source-data table exactly:

| stat | expected |
|---|---|
| `total` | 13463 |
| `withPhone` | 13463 |
| `withDelistDate` | 13463 |
| `mobile` | 12362 |
| `privateOwners` | 11237 |
| `bySegment.repeat` | 5415 |
| `bySegment.private_once` | 8048 |
| `byGrade` | A 4442 · B 5216 · C 3360 · D 445 |
| `byCity` | חיפה 8287 · קרית אתא 1327 · קרית ביאליק 1066 · קרית מוצקין 1048 · נשר 875 · קרית ים 860 |

If any number differs, the merge is wrong — fix it before continuing. Do not adjust the expected numbers.

- [ ] **Step 3: Spot-check one record against the raw CSV**

```bash
grep -m1 '^10561562,' docs/wehouse_haifa_properties.csv
grep    '^10561562,' docs/wehouse_haifa_movements.csv
```

Property `10561562` must come out as: `city='חיפה'`, `street='ככר היינה היינריך 18'`, `rooms=4`, `sqm=120`, `priceFirst=5600`, `priceLast=5600`, `priceChangePct=0`, `timesListed=1`, `delistedAt='2026-09-01'`, `maturesAt='2027-09-01'`, `segment='private_once'`, and a 4-entry timeline (216 → 217 → 217 → 218).

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/renewal-merge.mjs
git commit -m "feat(renewals): pure CSV merge + lead scoring module"
```

---

### Task 4: Import script — dry run

**Files:**
- Create: `scripts/import-renewal-leads.mjs`

**Interfaces:**
- Consumes: `buildRenewalRecords` from `scripts/lib/renewal-merge.mjs` (Task 3).
- Produces: a `--dry-run` report. No writes in this task.

- [ ] **Step 1: Write the script's read + plan phase**

CLI: `node scripts/import-renewal-leads.mjs --properties <csv> --movements <csv> [--org <uuid>] [--dry-run]`. Default org `11111111-1111-1111-1111-111111111111`.

Load from Supabase (service role, `org_id`-filtered) into memory once:
1. Existing properties: `id, external_id, contact_phone, contact_name, neighborhood, street, sqm, floor, rooms, price, outreach_blocked` where `external_id` is in the export's id set — fetched in chunks of 200 ids via `.in('external_id', chunk)`.
2. `whatsapp_suppression.phone` for the org → a `Set` of normalized numbers.
3. `approved_properties.property_id` → a `Set`.

Classify every record and compute the plan without writing:

```js
const plan = {
  propertiesToCreate: [],   // no existing row for this external_id
  propertiesToUpdate: [],   // existing row, with the field-level patch attached
  phoneFills: 0,            // existing row had no phone, export has one
  phoneConflicts: 0,        // existing row had a DIFFERENT phone
  leadsPending: 0,
  leadsSkipped: { approved_property: 0, outreach_blocked: 0, suppressed: 0 },
}
```

The update patch is an **explicit allowlist**. Nothing outside this list may ever be written to an existing row:

```js
// Writable on an EXISTING property. Everything else is off-limits: initial_message_sent,
// outreach_blocked, is_active, landlord_id, assigned_agent_user_id, agreed_commission_*, status.
function buildUpdatePatch(existing, rec) {
  const patch = {}
  if (!existing.contact_phone && rec.phone) patch.contact_phone = rec.phone
  else if (existing.contact_phone && rec.phone && normalize(existing.contact_phone) !== normalize(rec.phone)) {
    patch.contact_phone = rec.phone          // Nadlan One wins; previous value preserved below.
  }
  if (!existing.contact_name && rec.contactName) patch.contact_name = rec.contactName
  for (const col of ['neighborhood', 'street', 'sqm', 'floor', 'rooms', 'price']) {
    if (existing[col] == null && rec[col] != null) patch[col] = rec[col]
  }
  patch.timeline = rec.timeline
  patch.scraped_metadata = {
    ...(existing.scraped_metadata || {}),
    renewal_import: {
      at: new Date().toISOString(),
      source: 'nadlanone',
      delisted_at: rec.delistedAt,
      ...(patch.contact_phone && existing.contact_phone
        ? { previous_phone: existing.contact_phone }
        : {}),
    },
  }
  return patch
}
```

New properties get: `org_id`, `external_id`, `source: 'nadlanone_renewal'`, `is_active: false`, `title` (built as `` `${kind} ${rooms} חדרים ב${street}, ${city}` `` — `title` and `city` are `NOT NULL`), `city`, `neighborhood`, `street`, `address`, `type`, `rooms`, `sqm`, `floor`, `price`, `contact_name`, `contact_phone`, `images`, `amenities`, `timeline`, `scraped_metadata.renewal_import`.

Skip precedence, highest first: `approved_property` → `outreach_blocked` → `suppressed`. A skipped lead is still **created**, with `status='skipped'` and that `skip_reason`, so the campaign has a complete record.

- [ ] **Step 2: Run the dry run**

```bash
set -a; . ./.env.local; set +a; NODE_PATH="$(pwd)/node_modules" \
  node scripts/import-renewal-leads.mjs \
    --properties docs/wehouse_haifa_properties.csv \
    --movements  docs/wehouse_haifa_movements.csv \
    --dry-run
```

Expected — reconcile against the spec before going further:

| line | expected |
|---|---|
| properties to create | 4125 |
| properties to update | 9338 |
| phone fills | ~3875 |
| phone conflicts | ~435 |
| leads total | 13463 |
| leads skipped — `approved_property` | 35 |
| leads skipped — `outreach_blocked` | ~460 |
| leads skipped — `suppressed` | 63 |

If create+update ≠ 13463, or the create/update split differs from 4125/9338, stop and find out why before writing anything. The `~` figures depend on phone-normalization edge cases on the 3,146 two-number rows and may vary by a handful; the create/update split must be exact.

- [ ] **Step 3: Confirm the dry run wrote nothing**

```sql
select count(*) from renewal_leads;
```

Expected: `0`. If it is not zero, the `--dry-run` guard is broken — fix it before Task 5.

- [ ] **Step 4: Commit**

```bash
git add scripts/import-renewal-leads.mjs
git commit -m "feat(renewals): import script with dry-run plan"
```

---

### Task 5: Import script — live write + assertions

**Files:**
- Modify: `scripts/import-renewal-leads.mjs`

**Interfaces:**
- Produces: 4,125 new `properties` rows, 13,463 `renewal_leads` rows. Every later task reads these.

- [ ] **Step 1: Snapshot the existing rows so the merge can be proved non-destructive**

```bash
set -a; . ./.env.local; set +a; NODE_PATH="$(pwd)/node_modules" \
  node scripts/import-renewal-leads.mjs --properties docs/wehouse_haifa_properties.csv \
    --movements docs/wehouse_haifa_movements.csv --dry-run --snapshot /tmp/pre-import.json
```

Add a `--snapshot <path>` flag that writes, for every existing property that will be touched:
`{ id, external_id, initial_message_sent, outreach_blocked, is_active, landlord_id, assigned_agent_user_id, agreed_commission_months, agreed_commission_amount, status }`.
Expected: 9,338 entries.

- [ ] **Step 2: Add the write phase**

Batch with `supabaseService()`: `upsert` properties on `external_id` in chunks of 200; then `insert` `renewal_leads` in chunks of 500, resolving `property_id` from the upsert results. Wrap each chunk in try/catch and print any failing chunk's first error — a partial import must be visible, not silent.

Make it idempotent: re-running upserts the same properties and, because of `renewal_leads_org_external_unique`, re-inserting leads must use `.upsert(..., { onConflict: 'org_id,external_id', ignoreDuplicates: true })` so a second run is a no-op rather than a crash.

- [ ] **Step 3: Run it live**

```bash
set -a; . ./.env.local; set +a; NODE_PATH="$(pwd)/node_modules" \
  node scripts/import-renewal-leads.mjs \
    --properties docs/wehouse_haifa_properties.csv \
    --movements  docs/wehouse_haifa_movements.csv
```

- [ ] **Step 4: Assert the result**

All via MCP `execute_sql`.

```sql
-- 1. Row counts
select count(*) as leads,
       count(*) filter (where status='pending') as pending,
       count(*) filter (where status='skipped') as skipped
from renewal_leads;
```
Expected: `leads=13463`; `pending + skipped = 13463`; `skipped` ≥ 17.

```sql
-- 2. Every approved property is skipped, never pending
select count(*) from renewal_leads rl
join approved_properties ap on ap.property_id = rl.property_id
where rl.status <> 'skipped';
```
Expected: `0`.

```sql
-- 3. No blocked owner is pending
select count(*) from renewal_leads rl
join properties p on p.id = rl.property_id
where p.outreach_blocked = true and rl.status = 'pending';
```
Expected: `0`.

```sql
-- 4. No suppressed phone is pending
select count(*) from renewal_leads rl
join properties p on p.id = rl.property_id
join whatsapp_suppression s
  on regexp_replace(s.phone,'\D','','g') = regexp_replace(coalesce(p.contact_phone,''),'\D','','g')
where rl.status = 'pending';
```
Expected: `0`.

```sql
-- 5. New properties are inert: not active, correctly sourced
select count(*) from properties
where source='nadlanone_renewal' and (is_active = true);
```
Expected: `0`.

```sql
-- 6. Maturation curve reproduces the spec
select to_char(matures_at,'YYYY-MM') as m, count(*)
from renewal_leads group by 1 order by 1;
```
Expected: 2026-09 259 · 2026-10 512 · 2026-11 1222 · 2026-12 1192 · 2027-01 1139 · 2027-02 552 · 2027-04 934 · 2027-05 2064 · 2027-06 1854 · 2027-07 1184 · 2027-08 2508 · 2027-09 43. (2027-03 absent — the known source gap.)

```sql
-- 7. Due-now count
select count(*) from renewal_leads
where status='pending' and matures_at between current_date - 45 and current_date;
```
Expected: `259` when run on 2026-09-01.

- [ ] **Step 5: Prove no protected column changed on the 9,338**

Add a `--verify-snapshot <path>` flag that re-reads those ids and diffs the same field set. Run:

```bash
set -a; . ./.env.local; set +a; NODE_PATH="$(pwd)/node_modules" \
  node scripts/import-renewal-leads.mjs --verify-snapshot /tmp/pre-import.json
```

Expected: `0 differences across 9338 properties`. Any difference is a bug in `buildUpdatePatch` — investigate before proceeding.

- [ ] **Step 6: Commit**

```bash
git add scripts/import-renewal-leads.mjs
git commit -m "feat(renewals): live import with snapshot verification"
```

---

### Task 6: Template selection module

**Files:**
- Create: `lib/outreach/renewal-templates.ts`

**Interfaces:**
- Consumes: `renewal_leads.segment`, and the property's `contact_name`, `street`, `address`, `city`, `neighborhood`.
- Produces:
  - `export const RENEWAL_TEMPLATE_PRIVATE: string` (`'landlord_renewal_private_v1'`, env-overridable via `RENEWAL_TEMPLATE_PRIVATE`)
  - `export const RENEWAL_TEMPLATE_REPEAT: string` (`'landlord_renewal_repeat_v1'`, env `RENEWAL_TEMPLATE_REPEAT`)
  - `export type RenewalVars = { first_name: string; street_city: string; times_listed: string }`
  - `export function buildRenewalVariables(propertyId: string, timesListed: number): Promise<RenewalVars>` — throws `PersonalizationError` (re-used from `./personalization`) on bad data.
  - `export function pickRenewalTemplate(segment: 'private_once' | 'repeat', vars: RenewalVars): { templateName: string; components: TemplateComponentForSend[] }`
  - `export function renderRenewalPreview(segment, vars): string` — the body with `{{n}}` substituted, for the UI preview. Task 7 and Task 9 both use it.

- [ ] **Step 1: Write the module**

Reuse, do not reimplement: import `sanitizeFirstName` from `./name-sanitize`, and `PersonalizationError` plus the `TemplateComponentForSend` type from `./personalization`. Reuse `personalization.ts`'s `cleanCity`/`cleanStreet` behaviour by exporting them from that file and importing here rather than copying the regexes.

`buildRenewalVariables` mirrors `buildLandlordHookVariables` but needs **no images, no rooms, and no availability** — a year-old listing has none of those meaningfully. It throws on: missing phone (`phone_missing`), unusable name (`name_invalid:<reason>`), missing street (`street_missing`). `street_city` is `` `${cleanStreet(street)}, ${cleanCity(city)}` ``.

`pickRenewalTemplate` returns a `header` component with one text param (`street_city`) plus a `body` component with `[first_name, street_city]` for `private_once` and `[first_name, street_city, times_listed]` for `repeat`. The param order must match Task 2's `param_names` exactly.

- [ ] **Step 2: Typecheck**

```bash
npm run build
```

Expected: compiles. Strict mode is on with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, so index access needs explicit guards and optional properties must be conditionally spread (`...(x ? { k: x } : {})`), not set to `undefined`.

- [ ] **Step 3: Verify rendering against real data**

Pick two leads — one of each segment:

```sql
select rl.id, rl.segment, rl.times_listed, p.contact_name, p.street, p.city
from renewal_leads rl join properties p on p.id = rl.property_id
where rl.status='pending' and rl.segment='repeat' limit 1;
```

Confirm by reading the code that a lead with `contact_name='דנה'`, `street='ויצמן 4'`, `city='קרית מוצקין'`, `times_listed=3` produces `first_name='דנה'`, `street_city='ויצמן, קרית מוצקין'`, `times_listed='3'`, and selects `landlord_renewal_repeat_v1` with three body params in that order.

- [ ] **Step 4: Commit**

```bash
git add lib/outreach/renewal-templates.ts lib/outreach/personalization.ts
git commit -m "feat(renewals): renewal template selection + variable builder"
```

---

### Task 7: Renewal dispatcher

**Files:**
- Create: `lib/outreach/renewal-dispatcher.ts`
- Reference (do not modify): `lib/outreach/dispatcher.ts`

**Interfaces:**
- Consumes: `buildRenewalVariables`, `pickRenewalTemplate` (Task 6); `isSuppressed` (`./suppression`); `sendTemplate`, `normalizePhone` (`../whatsapp/meta-provider`); `canSendNow` (`../time/send-window`).
- Produces: `export async function dispatchRenewalOutreach(opts: { orgId: string; leadId: string; force?: boolean }): Promise<RenewalDispatchResult>` where

```ts
export type RenewalDispatchResult =
  | { ok: true; messageId: string; threadId: string; phone: string; templateName: string }
  | { ok: false; code: string; message: string }
```

Tasks 8 and 9 depend on these exact `code` values: `NOT_FOUND`, `ALREADY_SENT`, `SKIPPED`, `BLOCKED`, `APPROVED_PROPERTY`, `PHONE_MISSING`, `SUPPRESSED`, `PERSONALIZATION`, `SEND_WINDOW`, `TEMPLATE_MISSING`, `TEMPLATE_NOT_APPROVED`, `META_SEND_FAILED`, `DB_ERROR`.

- [ ] **Step 1: Read the reference dispatcher**

Read `lib/outreach/dispatcher.ts` end to end. The new function mirrors its shape and side-effect order exactly. Two deliberate differences, both load-bearing:

1. **It does not touch `properties.initial_message_sent`.** That flag means "we sent a first-touch about a *live listing*"; setting it here would silently corrupt the existing landlord queue's semantics. Double-contact protection comes from `recipientMessageCounts`, which already counts these sends because they go through `threads`/`messages`.
2. **It checks `canSendNow()` itself.** The landlord dispatcher leaves that to its callers; here it is a hard gate inside the dispatcher so no future caller can skip it.

- [ ] **Step 2: Write it**

Order of operations:

```
load lead (org-scoped) + its property
  → lead missing                       → NOT_FOUND
  → lead.status === 'sent' && !force   → ALREADY_SENT
  → lead.status === 'skipped' && !force→ SKIPPED
  → property.outreach_blocked          → BLOCKED   (also stamp lead skipped)
  → approved_properties has property   → APPROVED_PROPERTY (also stamp lead skipped)
  → !property.contact_phone            → PHONE_MISSING
  → canSendNow() false                 → SEND_WINDOW  (transient — do NOT stamp the lead)
  → isSuppressed(orgId, phone)         → SUPPRESSED (stamp lead skipped + property.outreach_blocked)
  → buildRenewalVariables throws       → PERSONALIZATION (stamp lead skipped + skip_reason)
  → template row missing               → TEMPLATE_MISSING
  → template row status !== 'approved' → TEMPLATE_NOT_APPROVED
  → sendTemplate throws                → META_SEND_FAILED (transient — do NOT stamp)
  → success: upsert thread by (org_id, phone) → insert messages row → update thread timestamps
            → update lead {status:'sent', sent_at, thread_id, message_id}
```

The distinction between transient failures (`SEND_WINDOW`, `META_SEND_FAILED`) and permanent ones matters: transient failures must leave `status='pending'` so the lead returns to the queue tomorrow.

The `messages` insert mirrors the landlord one:

```ts
const { data: msg } = await sb.from('messages').insert({
  org_id: orgId,
  thread_id: thread.id,
  property_id: property.id,
  channel: 'whatsapp',
  direction: 'out',
  body: null,
  status: 'sent',
  external_id: sent.messageId,
  meta_message_type: 'template',
  template_name: templateName,
  template_params: { first_name: vars.first_name, street_city: vars.street_city, times_listed: vars.times_listed },
  metadata: { renewal_lead_id: leadId, segment: lead.segment },
}).select('id').single()
```

Thread upsert is by `(org_id, phone)` and sets `property_id` — copy the `upsertThread` helper's behaviour from the reference dispatcher rather than inventing a variant.

- [ ] **Step 3: Typecheck**

```bash
npm run build && npm run lint
```

Expected: both clean.

- [ ] **Step 4: Prove the template gate holds before anything can send**

The templates from Task 2 are still `pending`, so this is the real behaviour right now, not a simulation. Start the dev server and call the single-send endpoint once Task 8 exists; for this task, verify by reading: confirm the `status !== 'approved'` branch returns before `sendTemplate` is called, and that no `messages` row or lead update happens on that path.

- [ ] **Step 5: Commit**

```bash
git add lib/outreach/renewal-dispatcher.ts
git commit -m "feat(renewals): renewal outreach dispatcher with send-window gate"
```

---

### Task 8: API routes

**Files:**
- Create: `app/api/v1/renewals/queue/route.ts`
- Create: `app/api/v1/renewals/pipeline/route.ts`
- Create: `app/api/v1/renewals/send-batch/route.ts`
- Create: `app/api/v1/renewals/send-one/route.ts`
- Create: `app/api/v1/renewals/skip/route.ts`
- Reference: `app/api/v1/outreach/landlord-queue/route.ts`, `app/api/v1/outreach/landlord-send-batch/route.ts`

**Interfaces:**
- Consumes: `requireAdminOrg` (`lib/outreach/admin-context`), `dispatchRenewalOutreach` (Task 7), `DAILY_CAP`/`MANUAL_BATCH_MAX`/`templatesSentToday`/`sleepJitter` (`lib/outreach/governance`), `renderRenewalPreview` (Task 6).
- Produces the response shapes Task 9 renders:

```ts
// GET /api/v1/renewals/queue?city=&grade=&segment=&limit=&offset=
{ ok: true, rows: RenewalRow[], counters: { sentToday: number; dailyCap: number; remaining: number },
  templates: { private: 'approved'|'pending'|'missing', repeat: 'approved'|'pending'|'missing' },
  hasMore: boolean }

type RenewalRow = {
  leadId: string; propertyId: string; externalId: string
  contactName: string | null; phone: string; phoneAlt: string | null; phoneKind: string | null
  city: string | null; street: string | null; neighborhood: string | null
  kind: string | null; rooms: number | null; sqm: number | null
  priceLast: number | null; priceChangePct: number | null
  delistedAt: string; maturesAt: string; daysOnMarket: number | null; timesListed: number
  segment: 'private_once' | 'repeat'; score: number; status: string
  preview: string                      // rendered body, from renderRenewalPreview
  received: { today: number; week: number }
}

// GET /api/v1/renewals/pipeline?...&page=  → { ok, rows, total, page, pageSize, aggregates }
// aggregates: { byMonth: Record<string, number>, byGrade: Record<string,number>,
//               byCity: Record<string,number>, bySegment: Record<string,number> }
// POST /api/v1/renewals/send-batch  { leadIds: string[] } → { ok, sent, skipped, results, ... }
// POST /api/v1/renewals/send-one    { leadId: string }    → RenewalDispatchResult
// POST /api/v1/renewals/skip        { leadId, reason }    → { ok: true }
```

- [ ] **Step 1: Write `queue/route.ts`**

Follow `landlord-queue/route.ts`'s structure. Select from `renewal_leads` joined to `properties` (`.select('..., properties!inner(contact_name, contact_phone, neighborhood, type, sqm, rooms)')`), filtered:

```ts
.eq('org_id', orgId)
.eq('status', 'pending')
.gte('matures_at', isoDaysAgo(45))
.lte('matures_at', todayIso())
.order('score', { ascending: false })
```

Plus optional `city`, `segment`, and `grade` (A→`score>=80`, B→`60..79`, C→`40..59`, D→`<40`). Enrich with `recipientMessageCounts` chunked at 120 phones, exactly as the landlord queue does. Read both template rows from `whatsapp_templates` to populate `templates`.

- [ ] **Step 2: Write `pipeline/route.ts`**

Server-side pagination, `pageSize = 50`, `count: 'exact'`. **13,463 rows must never reach the browser.** The four `aggregates` are computed with grouped queries against `renewal_leads`, not by fetching rows.

- [ ] **Step 3: Write the three POST routes**

`send-batch` copies `landlord-send-batch/route.ts` almost verbatim — `maxDuration = 180`, cap check against `DAILY_CAP - templatesSentToday(orgId)`, ceiling at `MANUAL_BATCH_MAX`, `await sleepJitter()` between sends, per-row `{ leadId, status, reason }` results. Call `dispatchRenewalOutreach` instead of `dispatchInitialOutreach`.

`send-one` is cap-free (matching `send-initial`) and returns the dispatch result unchanged.

`skip` sets `status='skipped'`, `skip_reason=<reason>`, `updated_at=now()`, org-scoped.

All five: `requireAdminOrg()` first, `401 { error: { code: 'NO_SESSION' } }` when null. These are session-authenticated admin routes, so **do not** add them to the `middleware.ts` allowlist — they must stay behind the session gate.

- [ ] **Step 4: Verify against the running server**

```bash
npm run dev
```

Then, logged in via the browser so the `sb-access-token` cookie exists, open:
- `http://localhost:3000/api/v1/renewals/queue` → `rows.length === 259` (before any send), `counters.dailyCap === 250`, and `templates.private === 'pending'`.
- `http://localhost:3000/api/v1/renewals/pipeline?page=1` → `total === 13463`, `rows.length === 50`, and `aggregates.byMonth['2027-03']` absent.

- [ ] **Step 5: Confirm the send path refuses while templates are pending**

`POST /api/v1/renewals/send-one` with any queued `leadId`. Expected: `{ ok: false, code: 'TEMPLATE_NOT_APPROVED', ... }`, and:

```sql
select status, sent_at from renewal_leads where id = '<leadId>';
```
Expected: still `pending`, `sent_at` null. Nothing was sent, nothing was stamped.

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/renewals
git commit -m "feat(renewals): queue, pipeline, send and skip endpoints"
```

---

### Task 9: `/renewals` page + sidebar

**Files:**
- Create: `app/renewals/page.tsx`
- Create: `components/renewals/RenewalQueue.tsx`
- Create: `components/renewals/RenewalPipeline.tsx`
- Modify: `components/shell/Sidebar.tsx`
- Reference: `app/outreach/page.tsx` (tab pattern, `seg-tabs` class, `CountersBar`, `ReceivedBadge`)

**Interfaces:**
- Consumes: the five endpoints from Task 8.

- [ ] **Step 1: Write the page shell**

`app/renewals/page.tsx` is a thin client component: an `h1` (`לידי חידוש`), a two-button tab switch (`מבשילים` / `הצנרת`), and the two child components. Keep it under ~60 lines — `app/outreach/page.tsx` is 873 lines and that is the thing being avoided.

- [ ] **Step 2: Write `RenewalQueue.tsx`**

Mirrors the landlord queue's interaction model: filter bar (city, grade, segment), select-all / select-N, a `CountersBar` showing `sentToday / dailyCap / remaining`, per-row expandable preview showing `row.preview` verbatim, `שלח נבחרים` calling `send-batch`, per-row `שלח` calling `send-one`, and `דלג` calling `skip`.

When `templates.private !== 'approved' || templates.repeat !== 'approved'`, render a prominent banner above the table and disable every send control:

> התבניות עדיין ממתינות לאישור Meta. אפשר לסקור ולסנן, אבל שליחה תיחסם עד שהאישור יתקבל.

Columns, RTL, in this order: checkbox · ציון (chip A/B/C/D) · כתובת (street bold, `city · neighborhood` beneath) · סוג · חד׳ · מחיר (with a red tag when `priceChangePct <= -3`) · איש קשר · טלפון (plus `phoneAlt` on a second line) · **ירד מפרסום** · ימים בפרסום · סבבים (amber tag when `timesListed >= 2`) · מבשיל · פעולות.

Use `font-variant-numeric: tabular-nums` on every numeric column.

- [ ] **Step 3: Write `RenewalPipeline.tsx`**

Server-paginated table over `/pipeline` with city / grade / segment / status / free-text filters and prev-next paging showing `total`. Above it, a horizontal bar chart of `aggregates.byMonth` — render the missing `2027-03` as an explicitly hatched "אין נתונים" row rather than omitting it, so the source gap stays visible.

- [ ] **Step 4: Add the sidebar entry**

In `components/shell/Sidebar.tsx`, import `History` from `lucide-react` and insert into `main` immediately after the `/outreach/renter-sends` entry:

```tsx
{ href: '/renewals', label: 'לידי חידוש', Icon: History },
```

The existing `NavLink` type already has an optional `badge`; populate it from the queue endpoint's row count using the same `useEffect` fetch pattern the file already uses for `Me`.

- [ ] **Step 5: Build, lint, and check it in the browser**

```bash
npm run build && npm run lint
```

Then with `npm run dev`, open `http://localhost:3000/renewals` and confirm:
1. "מבשילים" lists 259 rows, RTL, with the delist date populated on every row.
2. The pending-template banner is visible and every send control is disabled.
3. A row's preview renders the Hebrew body with the name and address substituted — and reads naturally.
4. "הצנרת" reports 13,463 total, pages 50 at a time, and the chart shows the March 2027 gap.
5. The sidebar shows `לידי חידוש` with a badge of 259.
6. Narrow the window to 390px: no horizontal body scroll; the table scrolls inside its own container.

- [ ] **Step 6: Commit**

```bash
git add app/renewals components/renewals components/shell/Sidebar.tsx
git commit -m "feat(renewals): /renewals page with maturing queue and pipeline browser"
```

---

## Post-plan, not in scope for these tasks

- **Deploy** — `npx vercel --prod`, manual, on the client's word.
- **First live send** — goes to the client's own number before any real lead, once Meta approves. Until then every send correctly fails closed.
- **Re-export of March 2026** — ~1,000 missing leads; a request to the client, not a code change.
- **The upstream fix** — rent360's external scraper is fed by this same Nadlan One feed and discards the movement `תאריך` on ingest. That is the root cause of the missing delist dates and is worth raising with whoever owns that scraper.

## Self-review

**Spec coverage.** §1 data model → Tasks 1, 4, 5. §2 maturation → Task 1 (`matures_at`), Task 3 (computation), Task 8 (the ±45-day query). §3 pipeline, all six gates → Task 7, verified in Tasks 5 and 8. §4 page → Task 9. §5 templates → Tasks 2 and 6. §6 import → Tasks 3–5. §7 verification → the verify steps of Tasks 3, 5, 8, 9. §8 risks → the pending-template banner (Task 9), the snapshot diff (Task 5), the March gap surfaced in the chart (Task 9). Acceptance criteria 1–5 all map: 1→Task 5 Step 4, 2→Task 9 Step 5, 3→Task 7 + Task 8 Step 4, 4→Task 8 Step 5, 5→Task 2 Step 5.

**Placeholders.** None — every code step carries real code, every verification step carries the exact command and its expected output.

**Type consistency.** `RenewalDispatchResult` (Task 7) is what `send-one` returns and Task 9 renders. `RenewalVars` field names (`first_name`, `street_city`, `times_listed`) match Task 2's `param_names` and Task 7's `template_params`. `segment` is `'private_once' | 'repeat'` in the migration CHECK, the merge module, the dispatcher, and the API types. `RenewalRow.leadId` is the key used by `send-batch`, `send-one`, and `skip`.
