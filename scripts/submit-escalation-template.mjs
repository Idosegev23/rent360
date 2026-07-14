/**
 * One-off: submit the `staff_escalation_reminder_v1` WhatsApp template to Meta for approval and
 * register it in `whatsapp_templates` (status 'pending'). The escalation cron gates on this row's
 * status and the existing `syncTemplateStatuses()` flips it to 'approved' automatically once Meta
 * approves — no redeploy needed. Until then the cron uses the approved admin_handoff_alert_v2 fallback.
 *
 * Run:  set -a; . ./.env.local; set +a; NODE_PATH="$(pwd)/node_modules" node scripts/submit-escalation-template.mjs
 * Idempotent: re-running when the template already exists at Meta just re-syncs the DB row.
 */
import { createClient } from '@supabase/supabase-js'

const NAME = 'staff_escalation_reminder_v1'
const LANGUAGE = 'he'
const CATEGORY = 'UTILITY'
const META_API = 'https://graph.facebook.com/v23.0'

const BODY_TEXT =
  '⏰ שיחה שהועברה לטיפול עדיין לא תועדה\n\n' +
  'היי {{1}}, שיחה ממתינה לטיפולך.\n' +
  'לקוח: {{2}}\n' +
  'ממתין כבר: {{3}}\n' +
  'סיבה: {{4}}\n\n' +
  'חזרת אליו? עדכן/י הערה במערכת כדי לסגור את הלולאה.'

const COMPONENTS = [
  {
    type: 'BODY',
    text: BODY_TEXT,
    example: { body_text: [['שי', 'דני כהן', '27 שעות', 'מבקש לסגור פגישה']] },
  },
  {
    type: 'BUTTONS',
    buttons: [
      {
        type: 'URL',
        text: 'פתח שיחה בדשבורד',
        url: 'https://rent360-vert.vercel.app/inbox/{{1}}',
        example: ['https://rent360-vert.vercel.app/inbox/abc-123-def'],
      },
    ],
  },
]

const waba = process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID
const token = process.env.META_WHATSAPP_ACCESS_TOKEN
const supabaseUrl = process.env.SUPABASE_URL
const serviceRole = process.env.SUPABASE_SERVICE_ROLE
if (!waba || !token) { console.error('Missing META_WHATSAPP_BUSINESS_ACCOUNT_ID / META_WHATSAPP_ACCESS_TOKEN'); process.exit(1) }
if (!supabaseUrl || !serviceRole) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE'); process.exit(1) }

async function getExisting() {
  const res = await fetch(`${META_API}/${waba}/message_templates?name=${NAME}&fields=name,status,id&limit=5`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const j = await res.json().catch(() => ({}))
  return (j.data || []).find((t) => t.name === NAME) || null
}

async function create() {
  const res = await fetch(`${META_API}/${waba}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NAME, category: CATEGORY, language: LANGUAGE, components: COMPONENTS }),
  })
  const j = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body: j }
}

async function main() {
  let metaId = null
  let metaStatus = 'PENDING'

  const existing = await getExisting()
  if (existing) {
    metaId = existing.id
    metaStatus = existing.status || 'PENDING'
    console.log(`Template already exists at Meta: id=${metaId} status=${metaStatus} — syncing DB only.`)
  } else {
    const r = await create()
    if (!r.ok || !r.body.id) {
      console.error(`Meta create failed (${r.status}):`, JSON.stringify(r.body))
      process.exit(1)
    }
    metaId = r.body.id
    metaStatus = r.body.status || 'PENDING'
    console.log(`Submitted to Meta: id=${metaId} status=${metaStatus}`)
  }

  const internalStatus = String(metaStatus).toUpperCase() === 'APPROVED' ? 'approved' : 'pending'
  const sb = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } })
  const row = {
    name: NAME,
    language: LANGUAGE,
    category: CATEGORY.toLowerCase(),
    status: internalStatus,
    body_template: BODY_TEXT,
    param_names: ['staff', 'contact', 'age', 'reason'],
    meta_template_id: metaId,
  }
  const { data: found } = await sb.from('whatsapp_templates').select('id').eq('name', NAME).maybeSingle()
  if (found) {
    await sb.from('whatsapp_templates').update(row).eq('id', found.id)
    console.log(`Updated whatsapp_templates row (${found.id}) → status=${internalStatus}`)
  } else {
    const { data: ins, error } = await sb.from('whatsapp_templates').insert(row).select('id').maybeSingle()
    if (error) { console.error('DB insert failed:', error.message); process.exit(1) }
    console.log(`Inserted whatsapp_templates row (${ins?.id}) → status=${internalStatus}`)
  }
  console.log('Done. Cron will flip to approved automatically once Meta approves.')
}

main().catch((e) => { console.error(e); process.exit(1) })
