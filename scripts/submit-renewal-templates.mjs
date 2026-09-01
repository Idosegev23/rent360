/**
 * One-off: submit the `landlord_renewal_private_v1` and `landlord_renewal_repeat_v1` WhatsApp
 * templates to Meta for approval and register them in `whatsapp_templates` (status 'pending').
 * The renewal-leads dispatcher (lib/outreach/renewal-templates.ts) refuses to send until Meta
 * approves and `syncTemplateStatuses()` flips these rows to 'approved' automatically — no
 * redeploy needed.
 *
 * Run:  set -a; . ./.env.local; set +a; NODE_PATH="$(pwd)/node_modules" node scripts/submit-renewal-templates.mjs
 * Idempotent: re-running when a template already exists at Meta just re-syncs its DB row.
 */
import { createClient } from '@supabase/supabase-js'

const LANGUAGE = 'he'
const CATEGORY = 'MARKETING'
const META_API = 'https://graph.facebook.com/v23.0'

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

const TEMPLATES = [
  {
    name: 'landlord_renewal_private_v1',
    bodyText: PRIVATE_BODY,
    components: PRIVATE_COMPONENTS,
    paramNames: ['first_name', 'street_city'],
  },
  {
    name: 'landlord_renewal_repeat_v1',
    bodyText: REPEAT_BODY,
    components: REPEAT_COMPONENTS,
    paramNames: ['first_name', 'street_city', 'times_listed'],
  },
]

const waba = process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID
const token = process.env.META_WHATSAPP_ACCESS_TOKEN
const supabaseUrl = process.env.SUPABASE_URL
const serviceRole = process.env.SUPABASE_SERVICE_ROLE
if (!waba || !token) { console.error('Missing META_WHATSAPP_BUSINESS_ACCOUNT_ID / META_WHATSAPP_ACCESS_TOKEN'); process.exit(1) }
if (!supabaseUrl || !serviceRole) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE'); process.exit(1) }

async function getExisting(name) {
  const res = await fetch(`${META_API}/${waba}/message_templates?name=${name}&fields=name,status,id&limit=5`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const j = await res.json().catch(() => ({}))
  return (j.data || []).find((t) => t.name === name) || null
}

async function create(name, components) {
  const res = await fetch(`${META_API}/${waba}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, category: CATEGORY, language: LANGUAGE, components }),
  })
  const j = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body: j }
}

async function submitOne(sb, tpl) {
  let metaId = null
  let metaStatus = 'PENDING'

  const existing = await getExisting(tpl.name)
  if (existing) {
    metaId = existing.id
    metaStatus = existing.status || 'PENDING'
    console.log(`[${tpl.name}] Already exists at Meta: id=${metaId} status=${metaStatus} — syncing DB only.`)
  } else {
    const r = await create(tpl.name, tpl.components)
    if (!r.ok || !r.body.id) {
      console.error(`[${tpl.name}] Meta create failed (${r.status}):`, JSON.stringify(r.body))
      process.exit(1)
    }
    metaId = r.body.id
    metaStatus = r.body.status || 'PENDING'
    console.log(`[${tpl.name}] Submitted to Meta: id=${metaId} status=${metaStatus}`)
  }

  const internalStatus = String(metaStatus).toUpperCase() === 'APPROVED' ? 'approved' : 'pending'
  const row = {
    name: tpl.name,
    language: LANGUAGE,
    category: CATEGORY.toLowerCase(),
    status: internalStatus,
    body_template: tpl.bodyText,
    param_names: tpl.paramNames,
    meta_template_id: metaId,
  }
  const { data: found } = await sb.from('whatsapp_templates').select('id').eq('name', tpl.name).maybeSingle()
  if (found) {
    await sb.from('whatsapp_templates').update(row).eq('id', found.id)
    console.log(`[${tpl.name}] Updated whatsapp_templates row (${found.id}) → status=${internalStatus}`)
  } else {
    const { data: ins, error } = await sb.from('whatsapp_templates').insert(row).select('id').maybeSingle()
    if (error) { console.error(`[${tpl.name}] DB insert failed:`, error.message); process.exit(1) }
    console.log(`[${tpl.name}] Inserted whatsapp_templates row (${ins?.id}) → status=${internalStatus}`)
  }
}

async function main() {
  const sb = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } })
  for (const tpl of TEMPLATES) {
    await submitOne(sb, tpl)
  }
  console.log('Done. Cron will flip each row to approved automatically once Meta approves.')
}

main().catch((e) => { console.error(e); process.exit(1) })
