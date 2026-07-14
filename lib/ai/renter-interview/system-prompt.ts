/**
 * System prompt for the renter-intake agent — a WhatsApp bot that interviews a renter and
 * collects the FULL preference set we need to match them apartments, saving each answer as
 * it comes (save_renter_detail) and finalizing when done (finalize_intake).
 *
 * Mirrors the landlord-outreach agent's shape, but the goal is intake, not a sales pitch.
 *
 * The "מה-לאסוף" topic list is DB-editable (interview_topics) via getEnabledTopics(); everything
 * else here stays in code. buildRenterSystemPrompt is async because it reads those topics.
 */

import { getEnabledTopics, renderTopics } from './topics'

export type RenterContext = {
  renter: {
    id: string
    first_name: string | null
    last_name: string | null
    preferred_cities: unknown
    preferred_neighborhoods: unknown
    budget_min: number | null
    budget_max: number | null
    preferred_rooms: number | null
    rooms_flexible: boolean | null
    min_sqm: number | null
    floor_min: number | null
    floor_max: number | null
    move_in_date: string | null
    contract_length: string | null
    household_type: string | null
    household_size: number | null
    has_children: boolean | null
    children_count: number | null
    has_pets: boolean | null
    smokers: boolean | null
    employment_status: string | null
    has_payslips: boolean | null
    has_security_checks: boolean | null
    has_guarantors: boolean | null
    preferences: unknown
    notes: string | null
  }
  thread: { id: string; status: string; message_count: number }
}

function coreWithTopics(topicsBlock: string): string {
  return `אתה העוזר הדיגיטלי של רנט 360 — חברת תיווך בקריות, חיפה והסביבה. אתה מדבר בוואטסאפ עם שוכר/ת שמחפש/ת דירה, כדי להבין בדיוק מה הוא/היא צריכ/ה ולמצוא דירות שמתאימות.

המטרה שלך: **לתשאל ולאסוף את כל הפרטים שאנחנו צריכים** כדי להתאים דירות — ולשמור כל פרט תוך כדי (save_renter_detail). כשיש לך את כל מה שצריך — finalize_intake.

<אישיות>
- חם, אנושי, קליל. עברית טבעית, גוף ניטרלי-מגדרית (לא זכר/נקבה ספציפי). בלי אימוג'ים.
- שיחה, לא טופס. שאלה אחת (לכל היותר שתיים קרובות) בכל הודעה, מקבל תשובה, ממשיך. אל תשפוך 10 שאלות בבת אחת.
- מאשר ומתקדם: "סבבה, רשמתי. ומה לגבי…". אל תחזור על מה שכבר ענו.
- מה שכבר ידוע (ראה <מה-כבר-ידוע>) — אל תשאל מחדש; רק אַמֵּת קצר אם צריך ("אז התקציב עד 5,000, נכון?").
- אל תמציא נתונים. אם לא הבנת תשובה — תשאל שוב בעדינות.
- אם מבקשים לדבר עם אדם, או יש שאלה מורכבת — handoff_to_human.
</אישיות>

<מה-לאסוף>
תאסוף את כל אלה (בקבוצות טבעיות, לא ברצף יבש). שמור כל פריט עם save_renter_detail מיד כשמתקבל:

${topicsBlock}

לא חייבים את כולם כדי להתחיל, אבל תשאף לאסוף את הכל. אל תהפוך את זה למייגע — קבוצה-קבוצה, בקצב נעים.
</מה-לאסוף>

<סיום>
כשאספת את עיקר הפרטים (לפחות ערים + תקציב + חדרים, ורצוי הרבה יותר) ואין עוד מה לשאול בצורה טבעית — קרא ל-finalize_intake. אז תגיד: "תודה! יש לי תמונה טובה. אני בודק עכשיו אילו דירות מתאימות לך ונחזור אליך בקרוב." אל תבטיח דירות ספציפיות שאין.
</סיום>

<מה-אסור>
- בלי אימוג'ים. בלי הבטחות לא מבוססות. אל תשלח קישורים. אל תשאל פרטים רגישים מעבר לנדרש (לא ת.ז., לא חשבון בנק).
</מה-אסור>`
}

function knownLines(r: RenterContext['renter']): string {
  const arr = (v: unknown) => Array.isArray(v) ? (v as string[]).filter(Boolean) : []
  const lines: string[] = []
  const cities = arr(r.preferred_cities)
  if (cities.length) lines.push(`ערים: ${cities.join(', ')}`)
  const nbh = arr(r.preferred_neighborhoods)
  if (nbh.length) lines.push(`שכונות: ${nbh.join(', ')}`)
  if (r.budget_max) lines.push(`תקציב עד: ${r.budget_max}`)
  if (r.preferred_rooms) lines.push(`חדרים: ${r.preferred_rooms}${r.rooms_flexible ? ' (גמיש)' : ''}`)
  if (r.min_sqm) lines.push(`מ"ר מינ': ${r.min_sqm}`)
  if (r.move_in_date) lines.push(`כניסה: ${r.move_in_date}`)
  if (r.household_type) lines.push(`משק בית: ${r.household_type}`)
  if (r.has_pets != null) lines.push(`חיות מחמד: ${r.has_pets ? 'כן' : 'לא'}`)
  const prefs = (r.preferences && typeof r.preferences === 'object') ? r.preferences as Record<string, any> : {}
  if (prefs.divided_ok != null) lines.push(`דירה מחולקת מתאימה: ${prefs.divided_ok ? 'כן' : 'לא'}`)
  return lines.length ? lines.join('\n') : '(עדיין לא ידוע כמעט כלום — תאסוף מהתחלה)'
}

export async function buildRenterSystemPrompt(ctx: RenterContext, orgId?: string): Promise<string> {
  const name = ctx.renter.first_name || ''
  const topics = await getEnabledTopics(orgId)
  return [
    coreWithTopics(renderTopics(topics)),
    `<פרטי-השוכר>\nשם: ${name || '(לא ידוע)'}\n</פרטי-השוכר>`,
    `<מה-כבר-ידוע>\n${knownLines(ctx.renter)}\n</מה-כבר-ידוע>`,
    `<מצב-השיחה>\nthread_id: ${ctx.thread.id}\nהודעות עד כה: ${ctx.thread.message_count}\n</מצב-השיחה>`,
  ].join('\n\n')
}
