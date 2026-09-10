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
  // The assignment already succeeded, so a failed log is reported, not fatal.
  const { error: logErr } = await sb.from('activity').insert({
    org_id: ORG, entity_type: 'property', entity_id: r.propertyId, author_user_id: null, kind: 'system',
    body: `שיוך אוטומטי: ${r.name}, לפי אישור הנכס`,
    metadata: { source: 'backfill-agent-assignment', assigned_to: r.userId },
  })
  if (logErr) console.warn(`activity log failed for ${r.propertyId}: ${logErr.message}`)
}
console.log(`assigned: ${ok} / ${plan.length}`)
