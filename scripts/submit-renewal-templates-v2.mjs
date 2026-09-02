/**
 * Submit the v2 renewal templates to Meta and register them in `whatsapp_templates`.
 *
 * v2 changes over v1 (v1 is already APPROVED and is left in place, untouched):
 *  - Client-rewritten copy ("משרד תיווך שפועל באזור", tighter framing, "רלוונטי לדבר 2 דקות?").
 *  - THREE quick-reply buttons instead of one. v1 offered only "להסיר אותי", which made saying no
 *    one tap and saying yes require typing — exactly backwards. Now:
 *      1. "כן, בואו נדבר"    → falls through to the AI conversation agent. meta-provider maps a
 *                              button tap to `type:'button'` with `text` = the label, the webhook
 *                              stores it as the message body, and the orchestrator runs.
 *      2. "לא רלוונטי כרגע"  → a soft no. Deliberately NOT matched by isHardOptOut(), so "not now"
 *                              never burns the lead the way "להסיר אותי" permanently does.
 *      3. "להסיר אותי"       → unchanged string. isHardOptOut() matches it exactly and the webhook
 *                              records the opt-out. NEVER edit this label.
 *    Any tap also opens Meta's 24h window, which is what lets the bot reply freely afterwards.
 *
 * Variable count and order are IDENTICAL to v1, so no application code changes are needed —
 * switching over is just the RENEWAL_TEMPLATE_PRIVATE / RENEWAL_TEMPLATE_REPEAT env vars.
 *
 * Run:  set -a; . ./.env.local; set +a; NODE_PATH="$(pwd)/node_modules" node scripts/submit-renewal-templates-v2.mjs
 * Idempotent: re-running when a template already exists at Meta just re-syncs its DB row.
 */
import { createClient } from '@supabase/supabase-js'

const LANGUAGE = 'he'
const CATEGORY = 'MARKETING'
const META_API = 'https://graph.facebook.com/v23.0'

// Order matters: the positive action first, the permanent opt-out last.
// "להסיר אותי" must stay byte-identical — lib/outreach/suppression.ts matches it by regex.
const BUTTONS = [
  { type: 'QUICK_REPLY', text: 'כן, בואו נדבר' },
  { type: 'QUICK_REPLY', text: 'לא רלוונטי כרגע' },
  { type: 'QUICK_REPLY', text: 'להסיר אותי' },
]

const NL = '\n'

const PRIVATE_BODY = [
  'היי {{1}} 👋',
  '',
  'לפני כשנה הדירה שלכם ב{{2}} פורסמה להשכרה ולאחר מכן ירדה מהפרסום - כנראה שמצאתם שוכרים.',
  '',
  'אנחנו רנט 360, משרד תיווך שפועל באזור. אם השוכרים מתחלפים בתקופה הקרובה, נשמח לחסוך לכם את כל ההתעסקות: איתור וסינון שוכרים, ליווי בתהליך החוזה והביטחונות, ותשלום רק במקרה של עסקה שנסגרה.',
  '',
  'רלוונטי לדבר 2 דקות?',
].join(NL)

const PRIVATE_COMPONENTS = [
  { type: 'HEADER', format: 'TEXT', text: '{{1}}', example: { header_text: ['הרצל, חיפה'] } },
  { type: 'BODY', text: PRIVATE_BODY, example: { body_text: [['שרון', 'הרצל, חיפה']] } },
  { type: 'BUTTONS', buttons: BUTTONS },
]

const REPEAT_BODY = [
  'היי {{1}} 👋',
  '',
  'הדירה שלכם ב{{2}} כבר עברה {{3}} סבבי פרסום להשכרה, אז אתם בטח מכירים את ההתעסקות שמגיעה עם כל סבב מחדש - פרסום, טלפונים, תיאומים, ביטולים וסינון שוכרים.',
  '',
  'אנחנו רנט 360, משרד תיווך שפועל באזור. אם מתקרב סבב נוסף, אנחנו יכולים לקחת את כל התהליך עלינו: איתור וסינון שוכרים, ליווי בתהליך החוזה והביטחונות, ותשלום רק במקרה של עסקה שנסגרה.',
  '',
  'רלוונטי לדבר 2 דקות?',
].join(NL)

const REPEAT_COMPONENTS = [
  { type: 'HEADER', format: 'TEXT', text: '{{1}}', example: { header_text: ['ויצמן, קרית מוצקין'] } },
  { type: 'BODY', text: REPEAT_BODY, example: { body_text: [['דנה', 'ויצמן, קרית מוצקין', '3']] } },
  { type: 'BUTTONS', buttons: BUTTONS },
]

const TEMPLATES = [
  {
    name: 'landlord_renewal_private_v2',
    bodyText: PRIVATE_BODY,
    components: PRIVATE_COMPONENTS,
    paramNames: ['first_name', 'street_city'],
  },
  {
    name: 'landlord_renewal_repeat_v2',
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
  console.log('Done. syncTemplateStatuses() flips each row to approved automatically once Meta approves.')
}

main().catch((e) => { console.error(e); process.exit(1) })
