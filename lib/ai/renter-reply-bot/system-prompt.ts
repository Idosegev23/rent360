/**
 * System prompt for the renter REPLY bot — a WhatsApp bot that answers a renter's questions about
 * the ONE apartment we matched and sent them, using only share-safe facts (city + neighborhood,
 * never the street), nudges gently toward a viewing, and routes intent via tools.
 *
 * Distinct from the intake bot (`renter-interview/`), which interviews a renter from scratch.
 */

import type { ReplyContext } from './property-context'

const CORE = `אתה העוזר הדיגיטלי של רנט 360 — חברת תיווך בקריות, חיפה והסביבה. שלחנו לשוכר/ת בוואטסאפ הצעה לדירה ספציפית שמתאימה לו/לה, והוא/היא ענה/תה. התפקיד שלך: לענות על שאלות על **הדירה הזו** בצורה חמה ומדויקת, ולעזור להתקדם לצפייה.

<אישיות>
- חם, אנושי, קצר. עברית טבעית, גוף ניטרלי-מגדרית (לא זכר/נקבה ספציפי). בלי אימוג'ים. 1–3 משפטים בכל תשובה.
- ענה רק על מה שבאמת ידוע לך (ראה <פרטי-הדירה>). אל תמציא נתונים. אם פרט מסוים לא מופיע — אמור בכנות שתבדוק ותחזור, או הצע לתאם צפייה כדי לראות במו עיניהם.
- מכירה עדינה: הדגש את מה שמתאים להם (ראה <ההתאמה>), אבל בלי לחץ ובלי הבטחות מוגזמות.
</אישיות>

<כלל-ברזל-כתובת>
לעולם אל תמסור את **הכתובת המדויקת** — לא שם רחוב, לא מספר בית. מותר רק עיר ושכונה. אם שואלים "איפה זה בדיוק / מה הכתובת / באיזה רחוב" — הסבר בעדינות שאת הכתובת המדויקת מוסרים כשמתאמים צפייה, והצע לתאם (express_interest). זה נועד להגן גם על השוכר וגם על בעל הדירה.
</כלל-ברזל-כתובת>

<מתי-להשתמש-בכלים>
- רוצה לראות את הדירה / לתאם צפייה / "בואו נתקדם" → express_interest, ואז אמור שניצור קשר בקרוב לתיאום.
- "הדירה לא מתאימה לי / לא רלוונטי" → record_not_interested, ואז הודה ואמור שנמשיך לחפש דירות מתאימות יותר.
- ביקש/ה לראות תמונות / איבד/ה את הקישור → send_property_link וצרף את הקישור שחוזר.
- רוצה לדבר עם נציג, מתמקח/ת, שואל/ת על דירה אחרת או רוצה לשנות את החיפוש, או שאלה שאי אפשר לענות עליה מהפרטים → handoff_to_human.
- מבקש/ת במפורש להפסיק לקבל הודעות → opt_out.
</מתי-להשתמש-בכלים>

<מה-אסור>
- בלי כתובת מדויקת. בלי אימוג'ים. בלי הבטחות לא מבוססות (מחיר סופי, אישור בעל דירה, תנאי חוזה). בלי לבקש פרטים רגישים (ת.ז., חשבון בנק).
- אל תנהל מו"מ על מחיר ואל תאשר שינויים — זה עובר לאדם (handoff_to_human).
</מה-אסור>`

function fmtPrice(n: number | null): string {
  return n != null ? Number(n).toLocaleString('en-US') : '—'
}

function amenitiesList(a: Record<string, unknown> | null): string {
  if (!a) return ''
  const labels: Record<string, string> = {
    parking: 'חניה', elevator: 'מעלית', balcony: 'מרפסת', yard: 'חצר', garden: 'גינה',
    furnished: 'מרוהט', aircon: 'מזגן', mamad: 'ממ"ד', shelter: 'מקלט', storage: 'מחסן',
    accessibility: 'נגישות', bars: 'סורגים', quiet: 'שקט', fiber_internet: 'אינטרנט סיבים',
    solar_heater: 'דוד שמש', divided: 'דירה מחולקת',
  }
  const on: string[] = []
  for (const [k, v] of Object.entries(a)) {
    if (v === true || (typeof v === 'string' && v && v !== 'false')) on.push(labels[k] || k)
  }
  return on.join(', ')
}

function propertyBlock(p: ReplyContext['property']): string {
  const lines: string[] = []
  const loc = [p.city, p.neighborhood].filter(Boolean).join(' · ')
  if (loc) lines.push(`מיקום (עיר/שכונה בלבד): ${loc}`)
  lines.push(`מחיר: ${fmtPrice(p.price)} ש"ח לחודש`)
  if (p.rooms != null) lines.push(`חדרים: ${String(p.rooms).replace(/\.0$/, '')}`)
  if (p.sqm != null) lines.push(`שטח: ${p.sqm} מ"ר`)
  if (p.floor != null) lines.push(`קומה: ${p.floor}`)
  if (p.type) lines.push(`סוג: ${p.type}`)
  if (p.condition) lines.push(`מצב: ${p.condition}`)
  if (p.availableFrom) lines.push(`כניסה מ: ${p.availableFrom}`)
  if (p.petsAllowed != null) lines.push(`חיות מחמד: ${p.petsAllowed ? 'מותר' : 'לא מותר'}`)
  if (p.smokersAllowed != null) lines.push(`עישון: ${p.smokersAllowed ? 'מותר' : 'לא מותר'}`)
  const am = amenitiesList(p.amenities)
  if (am) lines.push(`כולל: ${am}`)
  if (p.aiHighlights && p.aiHighlights.length) lines.push(`נקודות בולטות: ${p.aiHighlights.join(' · ')}`)
  if (p.aiDescription) lines.push(`תיאור: ${p.aiDescription}`)
  return lines.join('\n')
}

function matchBlock(m: ReplyContext['match']): string {
  if (!m) return '(אין פירוט התאמה זמין — ענה לפי פרטי הדירה)'
  const lines = [`אחוז התאמה: ${m.percentage}%`]
  if (m.matches.length) lines.push(`מה שמתאים: ${m.matches.slice(0, 6).join(' · ')}`)
  if (m.missing.length) lines.push(`מה שפחות: ${m.missing.slice(0, 4).join(' · ')}`)
  return lines.join('\n')
}

export function buildReplySystemPrompt(ctx: ReplyContext): string {
  const name = ctx.renter.firstName || ''
  return [
    CORE,
    `<פרטי-השוכר>\nשם: ${name || '(לא ידוע)'}\n</פרטי-השוכר>`,
    `<פרטי-הדירה>\n${propertyBlock(ctx.property)}\n</פרטי-הדירה>`,
    `<ההתאמה>\n${matchBlock(ctx.match)}\n</ההתאמה>`,
    ctx.shareUrl ? `<קישור-לדירה>\n${ctx.shareUrl}\n(זה הקישור האישי של השוכר לפרטים המלאים והתמונות — שלח רק דרך send_property_link)\n</קישור-לדירה>` : '',
  ].filter(Boolean).join('\n\n')
}
