/**
 * Defensive normalizers for values the renter-intake model hands to save_renter_detail.
 *
 * The WhatsApp bot collects answers in free Hebrew, and the model has historically
 * written non-canonical values into structured columns (e.g. household_type="יחיד"
 * instead of "single", or dropping a vague move-in date entirely). The web-form path
 * writes clean enum values + ISO dates, so bot rows ended up inconsistent with form
 * rows and broke any UI/label/filter keyed on the enum.
 *
 * These helpers map whatever the model sends onto the SAME canonical values the
 * questionnaire form uses (app/r/[token]/page.tsx), so both intake paths agree.
 * They are pure (inject `now` for the date parser) so they can be unit-verified.
 */

// Canonical enums — must match the questionnaire form option values.
export const HOUSEHOLD_TYPES = ['single', 'couple', 'family', 'roommates', 'students', 'other'] as const
export const EMPLOYMENT_STATUSES = ['employed', 'self_employed', 'student', 'other'] as const

/** Hebrew/free-text household type → canonical enum. Already-canonical values pass through. */
export function normalizeHouseholdType(value: unknown): string {
  const s = String(value ?? '').trim().toLowerCase()
  if (!s) return 'other'
  if ((HOUSEHOLD_TYPES as readonly string[]).includes(s)) return s
  if (/יחיד|לבד|רווק|בודד/.test(s)) return 'single'
  if (/זוג/.test(s)) return 'couple'
  if (/משפח/.test(s)) return 'family'
  if (/שותפ/.test(s)) return 'roommates'
  if (/סטודנט/.test(s)) return 'students'
  return 'other'
}

/**
 * Hebrew/free-text employment status → canonical enum. Already-canonical values pass
 * through. A genuinely mixed answer ("שכירה עצמאית וסטודנטית") maps to 'other' — the
 * detail belongs in notes, not a single enum.
 */
export function normalizeEmploymentStatus(value: unknown): string {
  const s = String(value ?? '').trim().toLowerCase()
  if (!s) return 'other'
  if ((EMPLOYMENT_STATUSES as readonly string[]).includes(s)) return s
  const cats = new Set<string>()
  if (/שכיר/.test(s)) cats.add('employed')
  if (/עצמא/.test(s)) cats.add('self_employed')
  if (/סטודנט/.test(s)) cats.add('student')
  if (/מובטל|לא עובד|אבטלה|פנסי|גמלא|פנסיונר/.test(s)) cats.add('other')
  if (cats.size === 1) return [...cats][0]!
  return 'other'
}

const HEB_MONTHS: Array<[RegExp, number]> = [
  [/ינואר/, 1], [/פברואר/, 2], [/מרץ|מרס/, 3], [/אפריל/, 4], [/מאי/, 5], [/יוני/, 6],
  [/יולי/, 7], [/אוגוסט|אוג['׳]/, 8], [/ספטמבר|ספט/, 9], [/אוקטובר|אוק/, 10],
  [/נובמבר|נוב/, 11], [/דצמבר|דצמ/, 12],
]

function pad(n: number): string { return n < 10 ? `0${n}` : `${n}` }

/**
 * Best-effort parse of a vague Hebrew move-in expression into an approximate ISO date.
 * "אמצע אוגוסט" → 15th of the next upcoming August; "תחילת" → 1st, "סוף"/"שלהי" → 25th.
 * "מיידי"/"עכשיו" → today. Multiple options ("אמצע אוגוסט או נובמבר") → the earliest.
 * Returns {date:null} when nothing recognizable is found (caller still marks flexible).
 *
 * `now` is injected so the year roll-over (past month → next year) is deterministic.
 */
export function parseHebrewMoveIn(value: unknown, now: Date): { date: string | null } {
  const s = String(value ?? '').trim().toLowerCase()
  if (!s) return { date: null }

  if (/מייד|מיד\b|עכשיו|בהקדם|כמה שיותר מהר|א\.?ס\.?א\.?פ/.test(s)) {
    return { date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` }
  }

  // Day-of-month modifier.
  let day = 15
  if (/תחיל|ראשית|בתחילת|מתחילת/.test(s)) day = 1
  else if (/סוף|שלהי|בסוף/.test(s)) day = 25

  // First month mentioned wins (earliest option in "X או Y" reads left-to-right anyway,
  // but we scan in calendar order and keep the earliest upcoming one).
  let best: { y: number; m: number } | null = null
  for (const [re, m] of HEB_MONTHS) {
    if (!re.test(s)) continue
    const curM = now.getMonth() + 1
    const y = m >= curM ? now.getFullYear() : now.getFullYear() + 1
    if (!best || y < best.y || (y === best.y && m < best.m)) best = { y, m }
  }
  if (best) return { date: `${best.y}-${pad(best.m)}-${pad(day)}` }

  return { date: null }
}
