# Agent Deal Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution decision for this plan:** inline in the controlling session, one review at the end (the client's standing preference after the renewals build). Only Task 3's live write touches existing production rows; it stops for confirmation.

**Goal:** A daily control board per agent — every open property grouped by an agent-owned stage with days-in-stage, next task, next meeting and a note — plus month-to-date progress against a deals + commission target, with unassigned properties surfaced at the top.

**Architecture:** Two new tables (`deal_stages`, `agent_targets`). A pure `lib/board/stages.ts` holds the seven stages and the one read-time rule (an active tenancy means `signed`). One GET route assembles the board from existing tables (`approved_properties`, `properties`, `tenancies`, `tasks`, `meetings`); two write routes set stage/note and targets; assignment reuses the existing assign endpoint. A one-time script backfills `assigned_agent_user_id` from the approver.

**Tech Stack:** Next.js 14 App Router · TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) · Supabase Postgres (service-role client, manual `org_id` filtering) · Tailwind + the project's `styles/globals.css` classes · Hebrew RTL.

**Spec:** `docs/superpowers/specs/2026-09-10-agent-deal-board-design.md`

## Global Constraints

- **No test runner.** `npm test` exits with an error. Never write or run jest/vitest/pytest; never claim tests pass. Verification = `--dry-run` output, queries through the service-role client, `npm run build`, `ESLINT_USE_FLAT_CONFIG=false npm run lint` (plain `npm run lint` is broken by a stray `~/eslint.config.js`), authenticated HTTP against `npm run dev`, and the browser.
- **Hebrew user-facing copy is gender-neutral** — plural or noun forms only. Buttons use noun forms: `שמירה`, `שיוך אליי`, `עריכת יעד`, `ביטול`.
- **Every query filters `org_id`.** Service-role calls bypass RLS. Org: `11111111-1111-1111-1111-111111111111`.
- **API auth is `requireOrg()`** (`lib/api/org-context.ts`) → `{ sb, orgId, uid, role }`, matching `/api/v1/pipeline` and `/api/v1/properties/[id]/assign`. Routes under `app/api/v1/` use relative imports, like their neighbours.
- **`approved_properties` has `approved_at`, not `created_at`.**
- **`tenancies.status` allows only `active` and `ended`.** Both count toward targets.
- **Vercel deploys are manual** (`npx vercel --prod`), and only on the client's word.
- **UI classes that exist** in `styles/globals.css`: `page-wrap`, `surface-card`, `surface-card-interactive`, `seg-tabs`, `btn`, `btn-sm`, `btn-primary`, `btn-ghost`, `pill`, `pill-gray|amber|blue|purple|pink|brand|green|red`, `faint`, `num`. Page shell = `<Topbar crumb=… title=… />` + `<div className="page-wrap">`, as in `app/renewals/page.tsx`.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0041_deal_board.sql` | `deal_stages`, `agent_targets`, constraints, RLS |
| `lib/board/stages.ts` | Pure: 7 stages, labels, `effectiveStage`, `daysSince`, month helpers. Client-safe. |
| `scripts/backfill-agent-assignment.mjs` | One-time approver → agent backfill, `--dry-run` |
| `app/api/v1/board/route.ts` | GET: assemble the board |
| `app/api/v1/board/stage/route.ts` | POST: set stage and/or note |
| `app/api/v1/board/targets/route.ts` | PUT: upsert a monthly target |
| `components/board/types.ts` | Client mirror of the GET response |
| `components/board/TargetsBar.tsx` | Month progress + inline target edit |
| `components/board/OrphansStrip.tsx` | Unassigned properties + "שיוך אליי" |
| `components/board/BoardRow.tsx` | One property row with inline stage/note |
| `components/board/StageGroup.tsx` | A stage heading + its rows |
| `app/board/page.tsx` | Shell: agent selector, fetch, layout |
| `components/shell/Sidebar.tsx` (modify) | Nav entry "לוח בקרה" |

---

### Task 1: Migration 0041

**Files:** Create `supabase/migrations/0041_deal_board.sql`

**Interfaces — Produces:** tables `deal_stages(property_id PK, org_id, stage, stage_changed_at, note, updated_by, updated_at)` and `agent_targets(id, org_id, user_id, month, target_deals, target_commission, created_at, updated_at)` with `UNIQUE (org_id, user_id, month)`.

- [ ] **Step 1: Write the migration**

```sql
-- Agent deal board (spec: docs/superpowers/specs/2026-09-10-agent-deal-board-design.md).
-- Agent-owned working stage per property + monthly targets. Complements /pipeline, which stays a
-- derived read-only funnel. Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.deal_stages (
  property_id      uuid PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  stage            text NOT NULL,
  -- Reset ONLY when the stage changes. A note edit must never make a stuck deal look fresh.
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  note             text,
  updated_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.deal_stages ADD CONSTRAINT deal_stages_stage_chk
    CHECK (stage IN ('new','waiting_owner','scheduling_viewing','viewed','docs_pending','signed','stuck'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS deal_stages_org_stage_idx ON public.deal_stages (org_id, stage);

ALTER TABLE public.deal_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_all_deal_stages ON public.deal_stages;
CREATE POLICY org_all_deal_stages ON public.deal_stages
  FOR ALL USING (org_id = public.jwt_org_id()) WITH CHECK (org_id = public.jwt_org_id());

CREATE TABLE IF NOT EXISTS public.agent_targets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  month             date NOT NULL,
  target_deals      int  NOT NULL DEFAULT 0,
  target_commission int  NOT NULL DEFAULT 0,   -- ₪, VAT-inclusive, same basis as tenancies.commission_amount
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.agent_targets ADD CONSTRAINT agent_targets_org_user_month_unique UNIQUE (org_id, user_id, month);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.agent_targets ADD CONSTRAINT agent_targets_month_is_first_chk CHECK (EXTRACT(DAY FROM month) = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.agent_targets ADD CONSTRAINT agent_targets_nonneg_chk CHECK (target_deals >= 0 AND target_commission >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.agent_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_all_agent_targets ON public.agent_targets;
CREATE POLICY org_all_agent_targets ON public.agent_targets
  FOR ALL USING (org_id = public.jwt_org_id()) WITH CHECK (org_id = public.jwt_org_id());
```

- [ ] **Step 2: Apply it**

Preferred: Supabase MCP `apply_migration` with name `0041_deal_board` (project convention). The MCP must be authorized first (`/mcp` in an interactive session).

Fallback, only if the MCP is unavailable: run `supabase migration list` and confirm remote history. Then `supabase db push --dry-run`. **Proceed only if the dry-run lists exactly `0041_deal_board.sql`** — older migrations were applied outside the CLI's history, and a push that replays them is not acceptable.

- [ ] **Step 3: Verify**

Against the service-role client, confirm both tables accept a select, and that inserting `stage = 'bogus'` into `deal_stages` fails on `deal_stages_stage_chk` inside a transaction you roll back — or simply read `pg_constraint` through the MCP:

```sql
select conname from pg_constraint
where conrelid in ('public.deal_stages'::regclass, 'public.agent_targets'::regclass) order by conname;
```
Expected: `agent_targets_month_is_first_chk`, `agent_targets_nonneg_chk`, `agent_targets_org_user_month_unique`, the three FKs, `deal_stages_stage_chk`, and both pkeys.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0041_deal_board.sql
git commit -m "feat(board): deal_stages + agent_targets (migration 0041)"
```

---

### Task 2: Pure stage module

**Files:** Create `lib/board/stages.ts`

**Interfaces — Produces:** `STAGES`, `type StageKey`, `STAGE_KEYS`, `MANUAL_STAGE_KEYS`, `isStageKey(v)`, `stageLabel(k)`, `effectiveStage(stored, hasActiveTenancy)`, `daysSince(iso, now?)`, `monthStartIso(d?)`, `nextMonthStartIso(monthStart)`.

- [ ] **Step 1: Write it**

```ts
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
```

- [ ] **Step 2: Verify** — `npm run build` compiles (the module has no consumers yet, so this proves only that it type-checks under strict mode).

- [ ] **Step 3: Commit**

```bash
git add lib/board/stages.ts
git commit -m "feat(board): pure stage definitions and effective-stage rule"
```

---

### Task 3: Assignment backfill

**Files:** Create `scripts/backfill-agent-assignment.mjs`

- [ ] **Step 1: Write it**

```js
/**
 * One-time: assign each approved, not-irrelevant, UNASSIGNED property to whoever approved it —
 * only when that approver is an ACTIVE user, never overwriting an existing assignment.
 * Spec: docs/superpowers/specs/2026-09-10-agent-deal-board-design.md §2.
 *
 * Run:  set -a; . ./.env.local; set +a; NODE_PATH="$(pwd)/node_modules" node scripts/backfill-agent-assignment.mjs [--dry-run]
 * Re-runnable: every UPDATE re-checks `assigned_agent_user_id is null`, so it only touches rows
 * that are still unassigned and cannot clobber an assignment made in the meantime.
 */
import { createClient } from '@supabase/supabase-js'

const ORG = '11111111-1111-1111-1111-111111111111'
const DRY = process.argv.includes('--dry-run')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE, { auth: { persistSession: false } })

const { data: users, error: uErr } = await sb.from('users').select('id, name, is_active').eq('org_id', ORG)
if (uErr) throw uErr
const U = new Map(users.map(u => [u.id, u]))

const { data: approved, error: aErr } = await sb
  .from('approved_properties').select('property_id, approved_by').eq('org_id', ORG).is('irrelevant_at', null)
if (aErr) throw aErr

const ids = approved.map(a => a.property_id)
const props = []
for (let i = 0; i < ids.length; i += 200) {
  const { data, error } = await sb.from('properties').select('id, assigned_agent_user_id').eq('org_id', ORG).in('id', ids.slice(i, i + 200))
  if (error) throw error
  props.push(...data)
}
const P = new Map(props.map(p => [p.id, p]))

const plan = []
const orphans = {}
let already = 0
for (const a of approved) {
  const p = P.get(a.property_id)
  if (!p) continue
  if (p.assigned_agent_user_id) { already++; continue }
  const u = a.approved_by ? U.get(a.approved_by) : null
  if (u && u.is_active) plan.push({ propertyId: p.id, userId: u.id, name: u.name })
  else {
    const reason = !a.approved_by ? 'no approver' : `${u?.name ?? 'unknown user'} (inactive)`
    orphans[reason] = (orphans[reason] || 0) + 1
  }
}

const byName = plan.reduce((m, r) => ((m[r.name] = (m[r.name] || 0) + 1), m), {})
console.log(`already assigned: ${already}`)
console.log('will assign:', byName)
console.log('stays unassigned:', orphans, `total ${Object.values(orphans).reduce((s, n) => s + n, 0)}`)
if (DRY) { console.log('--dry-run: nothing written.'); process.exit(0) }

let ok = 0
for (const r of plan) {
  const { data, error } = await sb.from('properties')
    .update({ assigned_agent_user_id: r.userId })
    .eq('id', r.propertyId).eq('org_id', ORG).is('assigned_agent_user_id', null)
    .select('id')
  if (error) { console.error(`FAIL ${r.propertyId}: ${error.message}`); process.exitCode = 1; continue }
  if (!data?.length) continue // assigned by someone in the meantime — leave it alone
  ok++
  // Same row shape logActivity() writes; the TS helper can't be imported from an .mjs script.
  await sb.from('activity').insert({
    org_id: ORG, entity_type: 'property', entity_id: r.propertyId, author_user_id: null, kind: 'system',
    body: `שיוך אוטומטי: ${r.name}, לפי אישור הנכס`,
    metadata: { source: 'backfill-agent-assignment', assigned_to: r.userId },
  })
}
console.log(`assigned: ${ok} / ${plan.length}`)
```

- [ ] **Step 2: Dry run and reconcile**

```bash
set -a; . ./.env.local; set +a; NODE_PATH="$(pwd)/node_modules" node scripts/backfill-agent-assignment.mjs --dry-run
```
Expected, exactly: `already assigned: 12` · `will assign: { שי: 29, עידו: 1 }` · `stays unassigned: { no approver: 13, 'Rent Admin (inactive)': 8, 'דריה (inactive)': 1 } total 22`. Any difference: stop and find out why before writing.

- [ ] **Step 3: STOP — present the dry run to the client and wait for explicit approval.** This writes to 30 existing production rows.

- [ ] **Step 4: Live run**, same command without `--dry-run`. Expected `assigned: 30 / 30`.

- [ ] **Step 5: Verify** with a service-role query: properties assigned to Shai among approved-not-irrelevant = **41**; unassigned among approved-not-irrelevant = **22**; `activity` rows with `metadata->>source = 'backfill-agent-assignment'` = **30**. Re-run `--dry-run`: expect `will assign: {}` (idempotent).

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill-agent-assignment.mjs
git commit -m "feat(board): one-time approver-to-agent assignment backfill"
```

---

### Task 4: GET /api/v1/board

**Files:** Create `app/api/v1/board/route.ts`

**Interfaces — Consumes:** `lib/board/stages.ts` (Task 2). **Produces:** the response shape mirrored in Task 6's `components/board/types.ts`.

- [ ] **Step 1: Write it**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireOrg } from '../../../../lib/api/org-context'
import {
  STAGES, effectiveStage, daysSince, monthStartIso, nextMonthStartIso, isStageKey, type StageKey,
} from '../../../../lib/board/stages'

/**
 * The agent deal board (spec: docs/superpowers/specs/2026-09-10-agent-deal-board-design.md).
 * Scope = approved, not-irrelevant properties assigned to `?agent=` (default: the viewer), plus the
 * unassigned ones surfaced as `orphans`. Next task / next meeting are read from the existing
 * `tasks` / `meetings` tables — the board never duplicates them.
 */
export const dynamic = 'force-dynamic'

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

type PropRow = {
  id: string; street: string | null; address: string | null; city: string | null
  contact_name: string | null; contact_phone: string | null; assigned_agent_user_id: string | null
}
type StageRow = { property_id: string; stage: string; stage_changed_at: string; note: string | null; updated_by: string | null; updated_at: string }
type TenancyRow = { property_id: string; started_at: string | null; created_at: string }
type TaskRow = { id: string; title: string; due_at: string | null; entity_id: string }
type MeetingRow = { id: string; title: string; starts_at: string; property_id: string }

const CHUNK = 200
async function inChunks<T>(ids: string[], fetchChunk: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await fetchChunk(ids.slice(i, i + CHUNK))))
  return out
}

/** Month anchor for a tenancy (spec §4): the move-in date, else when it was recorded. */
function tenancyAnchor(t: { started_at: string | null; created_at: string }): string {
  return (t.started_at || t.created_at).slice(0, 10)
}

export async function GET(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { sb, orgId, uid } = ctx
  const agentId = req.nextUrl.searchParams.get('agent') || uid
  const month = monthStartIso()
  const nextMonth = nextMonthStartIso(month)
  const nowIso = new Date().toISOString()

  const [agentsRes, approvedRes] = await Promise.all([
    sb.from('users').select('id, name').eq('org_id', orgId).eq('is_active', true).order('name'),
    sb.from('approved_properties').select('property_id, approved_at').eq('org_id', orgId).is('irrelevant_at', null),
  ])
  if (approvedRes.error) {
    return NextResponse.json({ error: { code: 'DB_ERROR', message: approvedRes.error.message } }, { status: 500 })
  }

  const approvedAt = new Map<string, string | null>()
  for (const a of approvedRes.data || []) approvedAt.set(a.property_id as string, (a.approved_at as string | null) ?? null)

  const props = await inChunks<PropRow>(Array.from(approvedAt.keys()), async c => {
    const { data } = await sb.from('properties')
      .select('id, street, address, city, contact_name, contact_phone, assigned_agent_user_id')
      .eq('org_id', orgId).in('id', c)
    return (data || []) as PropRow[]
  })
  const mine = props.filter(p => p.assigned_agent_user_id === agentId)
  const orphanProps = props.filter(p => !p.assigned_agent_user_id)
  const ids = [...mine, ...orphanProps].map(p => p.id)

  const [stages, tenancies, tasks, meetings] = await Promise.all([
    inChunks<StageRow>(ids, async c => ((await sb.from('deal_stages')
      .select('property_id, stage, stage_changed_at, note, updated_by, updated_at')
      .eq('org_id', orgId).in('property_id', c)).data || []) as StageRow[]),
    inChunks<TenancyRow>(ids, async c => ((await sb.from('tenancies')
      .select('property_id, started_at, created_at')
      .eq('org_id', orgId).eq('status', 'active').in('property_id', c)).data || []) as TenancyRow[]),
    inChunks<TaskRow>(ids, async c => ((await sb.from('tasks')
      .select('id, title, due_at, entity_id')
      .eq('org_id', orgId).eq('entity_type', 'property').in('status', ['open', 'in_progress']).in('entity_id', c)
      .order('due_at', { ascending: true, nullsFirst: false })).data || []) as TaskRow[]),
    inChunks<MeetingRow>(ids, async c => ((await sb.from('meetings')
      .select('id, title, starts_at, property_id')
      .eq('org_id', orgId).neq('status', 'cancelled').gte('starts_at', nowIso).in('property_id', c)
      .order('starts_at', { ascending: true })).data || []) as MeetingRow[]),
  ])

  const stageBy = new Map(stages.map(s => [s.property_id, s]))
  const tenancyBy = new Map(tenancies.map(t => [t.property_id, t]))
  // Rows arrive soonest-first; keep the first per property. Chunking can interleave, so compare.
  const taskBy = new Map<string, TaskRow>()
  for (const t of tasks) {
    const cur = taskBy.get(t.entity_id)
    if (!cur || (t.due_at ?? '9999') < (cur.due_at ?? '9999')) taskBy.set(t.entity_id, t)
  }
  const meetingBy = new Map<string, MeetingRow>()
  for (const m of meetings) {
    const cur = meetingBy.get(m.property_id)
    if (!cur || m.starts_at < cur.starts_at) meetingBy.set(m.property_id, m)
  }
  const nameBy = new Map((agentsRes.data || []).map(a => [a.id as string, (a.name as string) || '']))

  function toItem(p: PropRow): BoardItem | null {
    const s = stageBy.get(p.id)
    const ten = tenancyBy.get(p.id)
    const stored = s && isStageKey(s.stage) ? s.stage : null
    const stage = effectiveStage(stored, !!ten)
    // Signed deals stay only in the month they count toward — this is a board of OPEN properties.
    if (stage === 'signed') {
      const a = ten ? tenancyAnchor(ten) : ''
      if (!(a >= month && a < nextMonth)) return null
    }
    const since = stage === 'signed' && ten ? tenancyAnchor(ten) : (s?.stage_changed_at ?? approvedAt.get(p.id) ?? null)
    const task = taskBy.get(p.id)
    const mtg = meetingBy.get(p.id)
    return {
      propertyId: p.id,
      label: [p.street || p.address, p.city].filter(Boolean).join(', ') || 'נכס',
      ownerName: p.contact_name,
      ownerPhone: p.contact_phone,
      stage,
      daysInStage: daysSince(since),
      note: s?.note ?? null,
      nextTask: task ? { id: task.id, title: task.title, dueAt: task.due_at } : null,
      nextMeeting: mtg ? { id: mtg.id, title: mtg.title, startsAt: mtg.starts_at } : null,
      updatedBy: s?.updated_by ? (nameBy.get(s.updated_by) ?? null) : null,
      updatedAt: s?.updated_at ?? null,
    }
  }

  const byStale = (a: BoardItem, b: BoardItem) => b.daysInStage - a.daysInStage
  const items = mine.map(toItem).filter((x): x is BoardItem => x !== null)
  const orphans = orphanProps.map(toItem).filter((x): x is BoardItem => x !== null).sort(byStale)
  const groups = STAGES.map(st => ({
    stage: st.key,
    label: st.label,
    items: items.filter(i => i.stage === st.key).sort(byStale),
  }))

  const [targetRes, agentTenRes] = await Promise.all([
    sb.from('agent_targets').select('target_deals, target_commission')
      .eq('org_id', orgId).eq('user_id', agentId).eq('month', month).maybeSingle(),
    sb.from('tenancies').select('started_at, created_at, commission_amount')
      .eq('org_id', orgId).eq('created_by', agentId),
  ])
  let actualDeals = 0
  let actualCommission = 0
  for (const t of (agentTenRes.data || []) as Array<{ started_at: string | null; created_at: string; commission_amount: number | null }>) {
    const a = tenancyAnchor(t)
    if (a >= month && a < nextMonth) { actualDeals++; actualCommission += Number(t.commission_amount || 0) }
  }

  return NextResponse.json({
    me: { id: uid },
    agents: (agentsRes.data || []).map(a => ({ id: a.id as string, name: (a.name as string) || '' })),
    targets: {
      month,
      targetDeals: targetRes.data?.target_deals ?? 0,
      targetCommission: targetRes.data?.target_commission ?? 0,
      actualDeals,
      actualCommission,
    },
    orphans,
    groups,
  })
}
```

- [ ] **Step 2: Build** — `npm run build` compiles.

- [ ] **Step 3: Compute the expected counts from the data** (service-role, scratchpad script). Expected board items for Shai = his assigned approved-not-irrelevant properties **minus** those with an active tenancy anchored outside the current month. Expected orphans = unassigned approved-not-irrelevant **minus** the same exclusion. September targets for Shai = **2 deals, ₪10,400**.

- [ ] **Step 4: Verify over HTTP.** Start `npm run dev`. Mint a local session for the operator's own active account (`auth.admin.generateLink({ type: 'magiclink', email })` → `auth.verifyOtp({ type: 'magiclink', token_hash })`, no email is sent), set it as the `sb-access-token` cookie, and `GET /api/v1/board?agent=<shai id>`. Expected: HTTP 200; item count and orphan count equal Step 3's numbers exactly; `targets.actualDeals = 2`, `targets.actualCommission = 10400`; `groups` has 7 entries in spec order. No cookie → 307 to `/auth/login` (middleware).

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/board/route.ts
git commit -m "feat(board): GET board — stages, next task/meeting, orphans, targets"
```

---

### Task 5: Write routes — stage/note and targets

**Files:** Create `app/api/v1/board/stage/route.ts`, `app/api/v1/board/targets/route.ts`

- [ ] **Step 1: Write `stage/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireOrg } from '../../../../../lib/api/org-context'
import { logActivity } from '../../../../../lib/activity/log'
import { MANUAL_STAGE_KEYS, isStageKey, stageLabel, type StageKey } from '../../../../../lib/board/stages'

/**
 * Set a property's board stage and/or note. `stage_changed_at` moves ONLY on a real stage change —
 * a note edit must not make a stuck deal look fresh (spec §3). `signed` is rejected: an active
 * tenancy is what makes a property signed.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { sb, orgId, uid } = ctx

  let body: { propertyId?: unknown; stage?: unknown; note?: unknown } = {}
  try { body = await req.json() } catch { /* empty body */ }
  const propertyId = typeof body.propertyId === 'string' ? body.propertyId : ''
  if (!propertyId) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'propertyId required' } }, { status: 400 })

  let stage: StageKey | null = null
  if (body.stage !== undefined) {
    if (!isStageKey(body.stage) || !MANUAL_STAGE_KEYS.includes(body.stage)) {
      return NextResponse.json({ error: { code: 'BAD_STAGE', message: 'שלב לא חוקי. "חוזה נחתם" נקבע אוטומטית לפי רישום השכירות.' } }, { status: 400 })
    }
    stage = body.stage
  }
  const noteProvided = body.note !== undefined
  const note = typeof body.note === 'string' ? (body.note.trim().slice(0, 2000) || null) : null
  if (stage === null && !noteProvided) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'stage or note required' } }, { status: 400 })
  }

  const { data: prop } = await sb.from('properties').select('id').eq('id', propertyId).eq('org_id', orgId).maybeSingle()
  if (!prop) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })

  const { data: existing } = await sb.from('deal_stages').select('stage, note')
    .eq('property_id', propertyId).eq('org_id', orgId).maybeSingle()
  const prevStage = (existing?.stage as StageKey | undefined) ?? 'new'
  const stageChanged = stage !== null && stage !== prevStage
  const now = new Date().toISOString()

  const row: Record<string, unknown> = {
    property_id: propertyId, org_id: orgId, updated_by: uid, updated_at: now,
    stage: stage ?? prevStage,
  }
  if (stageChanged) {
    row.stage_changed_at = now
  } else if (!existing) {
    // First row with no stage change: keep the clock running from approval rather than restarting it.
    const { data: ap } = await sb.from('approved_properties').select('approved_at')
      .eq('property_id', propertyId).eq('org_id', orgId).maybeSingle()
    row.stage_changed_at = (ap?.approved_at as string | null) ?? now
  }
  if (noteProvided) row.note = note

  const { error } = await sb.from('deal_stages').upsert(row, { onConflict: 'property_id' })
  if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })

  if (stageChanged && stage) {
    await logActivity({
      orgId, entityType: 'property', entityId: propertyId, kind: 'status_change', authorUserId: uid,
      body: `שלב: ${stageLabel(prevStage)} ← ${stageLabel(stage)}`,
      metadata: { board: true, from: prevStage, to: stage },
    })
  }
  if (noteProvided && note && note !== existing?.note) {
    await logActivity({ orgId, entityType: 'property', entityId: propertyId, kind: 'note', authorUserId: uid, body: note, metadata: { board: true } })
  }
  return NextResponse.json({ ok: true, stageChanged })
}
```

- [ ] **Step 2: Write `targets/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireOrg } from '../../../../../lib/api/org-context'

/** Upsert one agent's target for one month. `month` is always the 1st ('YYYY-MM-01'). */
export async function PUT(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { sb, orgId } = ctx

  let body: { userId?: unknown; month?: unknown; targetDeals?: unknown; targetCommission?: unknown } = {}
  try { body = await req.json() } catch { /* empty body */ }
  const userId = typeof body.userId === 'string' ? body.userId : ''
  const month = typeof body.month === 'string' && /^\d{4}-\d{2}-01$/.test(body.month) ? body.month : ''
  const deals = Number(body.targetDeals)
  const commission = Number(body.targetCommission)
  if (!userId || !month || !Number.isInteger(deals) || deals < 0 || !Number.isInteger(commission) || commission < 0) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'userId, month (YYYY-MM-01) and non-negative whole numbers are required' } }, { status: 400 })
  }

  const { data: u } = await sb.from('users').select('id').eq('id', userId).eq('org_id', orgId).maybeSingle()
  if (!u) return NextResponse.json({ error: { code: 'BAD_USER' } }, { status: 400 })

  const { error } = await sb.from('agent_targets').upsert(
    { org_id: orgId, user_id: userId, month, target_deals: deals, target_commission: commission, updated_at: new Date().toISOString() },
    { onConflict: 'org_id,user_id,month' },
  )
  if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Build + lint** — `npm run build`, `ESLINT_USE_FLAT_CONFIG=false npm run lint`.

- [ ] **Step 4: Verify over HTTP, then clean up.** With the minted session, pick ONE of Shai's properties that has no `deal_stages` row:
  1. `POST /stage {propertyId, stage:'waiting_owner'}` → `{ok:true, stageChanged:true}`; row exists with `stage='waiting_owner'`; one `activity` row `kind='status_change'`, `metadata.board=true`.
  2. Record `stage_changed_at`. `POST /stage {propertyId, note:'בדיקה'}` → `stageChanged:false`; `stage_changed_at` **unchanged**; `note='בדיקה'`.
  3. `POST /stage {propertyId, stage:'signed'}` → HTTP 400 `BAD_STAGE`.
  4. `PUT /targets {userId:<shai>, month:<current month-01>, targetDeals:4, targetCommission:14000}` → ok; GET board shows the target.
  5. **Clean up:** delete that `deal_stages` row, the two `activity` rows for that property with `metadata->>board = 'true'` created in this step, and the `agent_targets` row — the client sets the real target in the UI.

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/board/stage/route.ts app/api/v1/board/targets/route.ts
git commit -m "feat(board): stage/note and monthly-target write routes"
```

---

### Task 6: The page, its components, and the nav entry

**Files:** Create `components/board/types.ts`, `components/board/TargetsBar.tsx`, `components/board/OrphansStrip.tsx`, `components/board/BoardRow.tsx`, `components/board/StageGroup.tsx`, `app/board/page.tsx`. Modify `components/shell/Sidebar.tsx`.

- [ ] **Step 1: `components/board/types.ts`**

```ts
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
```

- [ ] **Step 2: `components/board/TargetsBar.tsx`**

```tsx
'use client'
import { useState } from 'react'
import type { BoardTargets } from './types'
import { fmtShekel } from './types'

function Meter({ label, actual, target, format }: { label: string; actual: number; target: number; format: (n: number) => string }) {
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0
  return (
    <div className="flex-1" style={{ minWidth: 180 }}>
      <div className="flex items-baseline justify-between text-sm mb-1">
        <span className="faint">{label}</span>
        <span className="num font-semibold">{format(actual)}{target > 0 && <span className="faint"> / {format(target)}</span>}</span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: 'var(--line, #e5e7eb)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? 'var(--green, #16a34a)' : 'var(--brand, #2563eb)' }} />
      </div>
    </div>
  )
}

export default function TargetsBar({ targets, userId, onSaved }: { targets: BoardTargets; userId: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [deals, setDeals] = useState(String(targets.targetDeals))
  const [commission, setCommission] = useState(String(targets.targetCommission))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const monthLabel = new Date(`${targets.month}T12:00:00`).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })

  async function save() {
    setSaving(true); setErr(null)
    const r = await fetch('/api/v1/board/targets', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, month: targets.month, targetDeals: Number(deals), targetCommission: Number(commission) }),
    }).catch(() => null)
    setSaving(false)
    if (!r || !r.ok) { setErr('השמירה נכשלה — צריך מספרים שלמים, 0 ומעלה.'); return }
    setEditing(false); onSaved()
  }

  return (
    <div className="surface-card mb-4" style={{ padding: 16 }}>
      <div className="flex items-center justify-between mb-3">
        <span className="font-semibold">יעד {monthLabel}</span>
        {!editing && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>עריכת יעד</button>}
      </div>
      {editing ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">עסקאות
            <input type="number" min={0} step={1} value={deals} onChange={e => setDeals(e.target.value)} className="block border rounded px-2 py-1 mt-1 num" style={{ width: 110 }} />
          </label>
          <label className="text-sm">עמלות (₪)
            <input type="number" min={0} step={100} value={commission} onChange={e => setCommission(e.target.value)} className="block border rounded px-2 py-1 mt-1 num" style={{ width: 140 }} />
          </label>
          <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={save}>שמירה</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>ביטול</button>
          {err && <span className="text-sm" style={{ color: 'var(--red, #dc2626)' }}>{err}</span>}
        </div>
      ) : (
        <div className="flex flex-wrap gap-6">
          <Meter label="עסקאות" actual={targets.actualDeals} target={targets.targetDeals} format={n => String(n)} />
          <Meter label="עמלות" actual={targets.actualCommission} target={targets.targetCommission} format={fmtShekel} />
        </div>
      )}
      {!editing && targets.targetDeals === 0 && targets.targetCommission === 0 && (
        <p className="text-xs faint mt-2">עוד לא הוגדר יעד לחודש הזה.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: `components/board/BoardRow.tsx`**

```tsx
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { MANUAL_STAGE_KEYS, stageLabel, type StageKey } from '../../lib/board/stages'
import type { BoardItem } from './types'
import { STAGE_TONE, fmtShortDate } from './types'

function DaysPill({ days }: { days: number }) {
  const tone = days >= 14 ? 'pill-red' : days >= 7 ? 'pill-amber' : 'pill-gray'
  return <span className={`pill ${tone} num`} title="ימים בשלב הנוכחי">{days} ימים</span>
}

export default function BoardRow({ item, onChanged }: { item: BoardItem; onChanged: () => void }) {
  const [noteDraft, setNoteDraft] = useState(item.note ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const noteDirty = noteDraft.trim() !== (item.note ?? '')

  async function post(payload: { stage?: StageKey; note?: string }) {
    setBusy(true); setErr(null)
    const r = await fetch('/api/v1/board/stage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId: item.propertyId, ...payload }),
    }).catch(() => null)
    setBusy(false)
    if (!r || !r.ok) { setErr('העדכון נכשל. אפשר לנסות שוב.'); return }
    onChanged()
  }

  return (
    <div className="surface-card" style={{ padding: 12 }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div style={{ minWidth: 0 }}>
          <Link href={`/properties/${item.propertyId}`} className="font-semibold text-sm no-underline" style={{ color: 'var(--ink)' }}>{item.label}</Link>
          <div className="text-xs faint">
            {item.ownerName || 'ללא שם'}
            {item.ownerPhone && <> · <a href={`tel:${item.ownerPhone}`} className="num">{item.ownerPhone}</a></>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DaysPill days={item.daysInStage} />
          {item.stage === 'signed' ? (
            <span className={`pill ${STAGE_TONE.signed}`}>{stageLabel('signed')}</span>
          ) : (
            <select
              aria-label="שלב"
              value={item.stage}
              disabled={busy}
              onChange={e => void post({ stage: e.target.value as StageKey })}
              className="border rounded px-2 py-1 text-sm"
            >
              {MANUAL_STAGE_KEYS.map(k => <option key={k} value={k}>{stageLabel(k)}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mt-2 text-xs">
        <span>
          <span className="faint">משימה הבאה: </span>
          {item.nextTask
            ? <Link href="/tasks">{item.nextTask.title}{item.nextTask.dueAt && <span className="faint num"> · {fmtShortDate(item.nextTask.dueAt)}</span>}</Link>
            : <span className="faint">אין</span>}
        </span>
        <span>
          <span className="faint">פגישה קרובה: </span>
          {item.nextMeeting
            ? <Link href="/meetings">{item.nextMeeting.title}<span className="faint num"> · {fmtShortDate(item.nextMeeting.startsAt)}</span></Link>
            : <span className="faint">אין</span>}
        </span>
      </div>

      <div className="flex items-center gap-2 mt-2">
        <input
          aria-label="הערה"
          value={noteDraft}
          onChange={e => setNoteDraft(e.target.value)}
          placeholder="הערה — למשל: ממתין לצ׳קים מהשוכר"
          className="flex-1 border rounded px-2 py-1 text-sm"
          maxLength={2000}
        />
        {noteDirty && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void post({ note: noteDraft })}>שמירה</button>}
      </div>
      {(item.updatedBy || err) && (
        <div className="text-xs mt-1">
          {err ? <span style={{ color: 'var(--red, #dc2626)' }}>{err}</span>
               : <span className="faint">עדכון אחרון: {item.updatedBy}{item.updatedAt && ` · ${fmtShortDate(item.updatedAt)}`}</span>}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: `components/board/StageGroup.tsx`**

```tsx
'use client'
import { useState } from 'react'
import type { StageKey } from '../../lib/board/stages'
import type { BoardItem } from './types'
import { STAGE_TONE } from './types'
import BoardRow from './BoardRow'

export default function StageGroup({ stage, label, items, onChanged }: { stage: StageKey; label: string; items: BoardItem[]; onChanged: () => void }) {
  // Signed deals are this month's wins — collapsed so the open work leads.
  const [open, setOpen] = useState(stage !== 'signed')
  if (items.length === 0 && stage !== 'stuck') return null
  return (
    <section className="mb-4">
      <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-2 mb-2 px-1" aria-expanded={open}>
        <span className="font-semibold">{label}</span>
        <span className={`pill ${STAGE_TONE[stage]} num`}>{items.length}</span>
        <span className="faint text-xs">{open ? 'הסתרה' : 'הצגה'}</span>
      </button>
      {open && (
        items.length === 0
          ? <div className="text-xs faint px-1">אין דירות תקועות כרגע.</div>
          : <div className="flex flex-col gap-2">{items.map(it => <BoardRow key={it.propertyId} item={it} onChanged={onChanged} />)}</div>
      )}
    </section>
  )
}
```

- [ ] **Step 5: `components/board/OrphansStrip.tsx`**

```tsx
'use client'
import { useState } from 'react'
import Link from 'next/link'
import type { BoardItem } from './types'

export default function OrphansStrip({ orphans, meId, onChanged }: { orphans: BoardItem[]; meId: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  if (orphans.length === 0) return null

  async function claim(propertyId: string) {
    setBusyId(propertyId)
    // Reuses the existing assign endpoint — it already rejects inactive agents.
    await fetch(`/api/v1/properties/${propertyId}/assign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentUserId: meId }),
    }).catch(() => null)
    setBusyId(null)
    onChanged()
  }

  return (
    <div className="surface-card mb-4" style={{ padding: 12, borderInlineStart: '4px solid var(--amber, #d97706)' }}>
      <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-2 w-full" aria-expanded={open}>
        <span className="pill pill-amber num">{orphans.length}</span>
        <span className="font-semibold text-sm">נכסים מאושרים ללא סוכן</span>
        <span className="faint text-xs">{open ? 'הסתרה' : 'הצגה'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1 mt-2">
          {orphans.map(o => (
            <div key={o.propertyId} className="flex items-center justify-between gap-2 text-sm py-1">
              <div style={{ minWidth: 0 }}>
                <Link href={`/properties/${o.propertyId}`} className="no-underline" style={{ color: 'var(--ink)' }}>{o.label}</Link>
                <span className="faint text-xs"> · {o.ownerName || 'ללא שם'} · <span className="num">{o.daysInStage}</span> ימים</span>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busyId === o.propertyId} onClick={() => void claim(o.propertyId)}>שיוך אליי</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: `app/board/page.tsx`**

```tsx
'use client'
import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import Topbar from '../../components/shell/Topbar'
import TargetsBar from '../../components/board/TargetsBar'
import OrphansStrip from '../../components/board/OrphansStrip'
import StageGroup from '../../components/board/StageGroup'
import type { BoardData } from '../../components/board/types'

export default function BoardPage() {
  // null = the server's default (the viewer). Set only by the selector, so the first load fetches once.
  const [agent, setAgent] = useState<string | null>(null)
  const [data, setData] = useState<BoardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await fetch(`/api/v1/board${agent ? `?agent=${encodeURIComponent(agent)}` : ''}`)
      if (!r.ok) throw new Error(String(r.status))
      setData((await r.json()) as BoardData)
    } catch {
      setError('טעינת הלוח נכשלה. אפשר לרענן את העמוד.')
    } finally {
      setLoading(false)
    }
  }, [agent])

  useEffect(() => { setLoading(true); void load() }, [load])

  const selectedAgent = agent ?? data?.me.id ?? ''
  const openCount = data ? data.groups.filter(g => g.stage !== 'signed').reduce((s, g) => s + g.items.length, 0) : 0

  return (
    <>
      <Topbar crumb="בית · לוח בקרה" title="לוח בקרה" />
      <div className="page-wrap">
        {data && (
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <label className="text-sm flex items-center gap-2">
              <span className="faint">הלוח של</span>
              <select value={selectedAgent} onChange={e => setAgent(e.target.value)} className="border rounded px-2 py-1 text-sm">
                {data.agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <span className="text-sm faint num">{openCount} דירות פתוחות</span>
          </div>
        )}
        {loading && !data ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div>
        ) : error ? (
          <div className="surface-card text-sm" style={{ padding: 16 }}>{error}</div>
        ) : data ? (
          <>
            <TargetsBar key={`${selectedAgent}-${data.targets.month}`} targets={data.targets} userId={selectedAgent} onSaved={() => void load()} />
            <OrphansStrip orphans={data.orphans} meId={data.me.id} onChanged={() => void load()} />
            {data.groups.map(g => (
              <StageGroup key={g.stage} stage={g.stage} label={g.label} items={g.items} onChanged={() => void load()} />
            ))}
            {openCount === 0 && <div className="text-sm faint text-center py-8">אין דירות פתוחות בלוח הזה.</div>}
          </>
        ) : null}
      </div>
    </>
  )
}
```

- [ ] **Step 7: Sidebar** — in `components/shell/Sidebar.tsx`, add `Target` to the `lucide-react` import list and insert, directly after the `/action` entry:

```tsx
  { href: '/board',                label: 'לוח בקרה',        Icon: Target },
```

- [ ] **Step 8: Build + lint** — `npm run build` (the `/board` route must appear), `ESLINT_USE_FLAT_CONFIG=false npm run lint` (0 errors).

- [ ] **Step 9: Verify in the running app** (`npm run dev`, minted session): `GET /board` → 200. In the browser at 1280px and 390px: orphans strip shows the Task 4 count; Shai's groups render in spec order with the stalest first; `stuck` group renders even when empty; `signed` collapsed; changing a stage re-renders the row in its new group with `0 ימים`; editing a note shows `שמירה` and keeps the day count; the target edit saves and the meters move; no horizontal page scroll at 390px. **Revert any stage/note/target set during this check**, as in Task 5 Step 4.

- [ ] **Step 10: Commit**

```bash
git add components/board app/board components/shell/Sidebar.tsx
git commit -m "feat(board): /board page — targets, orphans, stage groups, nav entry"
```

---

### Task 7: One review, then hand back

- [ ] **Step 1:** Dispatch one whole-branch code review (most capable model) over the plan's commits, with the spec, pointing at: the stage-clock invariant (note edits never move `stage_changed_at`), the `signed` rule, org scoping on every query, the backfill's never-overwrite guard, and gender-neutral copy.
- [ ] **Step 2:** Fix what it finds in one pass; re-verify the touched behaviour.
- [ ] **Step 3:** Report to the client with the live numbers. **Do not deploy** until the client says so.

## Self-review

**Spec coverage.** §1 data model → Task 1; seven stages + effective-stage rule → Task 2, applied in Task 4; signed-this-month-only → Task 4 `toItem`. §2 scope + agent selector → Task 4 `?agent=`, Task 6 selector; backfill with active-only + never-overwrite → Task 3; orphan surfacing → Task 4 `orphans`, Task 6 `OrphansStrip`. §3 GET shape → Task 4; POST with clock-only-on-change → Task 5; PUT → Task 5; `me.id` from `ctx.uid` → Task 4. §4 targets with `coalesce(started_at, created_at)` and no status filter → Task 4. §5 page → Task 6. §6 verification → each task's verify step. Execution → header note and Task 3 Step 3.

**Placeholders.** None — every code step carries the full file.

**Type consistency.** `BoardItem`/`BoardData` fields in `components/board/types.ts` match the route's `BoardItem` and response literal exactly. `StageKey`, `MANUAL_STAGE_KEYS`, `stageLabel`, `isStageKey`, `effectiveStage`, `daysSince`, `monthStartIso`, `nextMonthStartIso` are defined in Task 2 and used with those names in Tasks 4–6. The stage keys in the migration CHECK equal `STAGE_KEYS`.
