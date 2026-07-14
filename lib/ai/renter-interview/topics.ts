import { supabaseService } from '../../supabase'

/**
 * The renter-interview "מה-לאסוף" topic list — the ONE part of the intake prompt that's editable
 * from the admin UI (DB table `interview_topics`). Everything else in the prompt stays in code.
 *
 * DEFAULT_TOPICS is the canonical seed AND the runtime fallback: if the DB has no rows for the org
 * (or the read fails), the bot uses these, so it always works. The first admin save persists rows
 * that then override these defaults. Keep the wording here in sync with the questionnaire form.
 */
export type InterviewTopic = { key: string; title: string; body_text: string }

export const DEFAULT_TOPICS: InterviewTopic[] = [
  { key: 'location', title: 'מיקום', body_text: 'באילו ערים מחפשים? (preferred_cities, מערך) ושכונות מועדפות אם יש (preferred_neighborhoods).' },
  { key: 'budget', title: 'תקציב', body_text: 'עד כמה לחודש? (budget_max) ומינימום אם רלוונטי (budget_min). אפשר לשאול גם על תקרת ועד בית/ארנונה אם זה עולה (vaad_bayit_max / arnona_max) — לא חובה.' },
  { key: 'apartment', title: 'דירה', body_text: 'כמה חדרים? (preferred_rooms — מספר בלבד). אם "לא משנה"/טווח רחב → שלח rooms_flexible=true ואל תשלח preferred_rooms בכלל. גודל מינימלי במ"ר? (min_sqm). קומה מועדפת/טווח? (floor_min/floor_max, top_floor_preference). מצב הדירה (משופצת/טובה/לא משנה → condition_preference).' },
  { key: 'move_in', title: 'כניסה', body_text: 'מתי צריך להיכנס? (move_in_date; גמיש → move_in_flexible). אם יש תאריך מדויק שלח אותו בפורמט YYYY-MM-DD; אם מעורפל ("אמצע אוגוסט") שלח את הטקסט כפי שנאמר — המערכת תפרש אותו ותסמן גמיש. אורך חוזה מועדף? (contract_length: 6/12/flexible).' },
  { key: 'household', title: 'משק בית', body_text: 'מי גר? (household_type — שלח אחד מ: single/couple/family/roommates/students = יחיד/זוג/משפחה/שותפים/סטודנטים; כל דבר אחר → other). כמה נפשות (household_size). ילדים? כמה (has_children, children_count). חיות מחמד? (has_pets). מעשנים? (smokers).' },
  { key: 'amenities', title: 'חובה / יתרון', body_text: 'לכל אחד: חובה / יתרון / לא משנה. חניה (parking), מעלית (elevator), מרפסת (balcony), חצר (yard), מרוהט (furnished), מזגן (aircon), ממ"ד (mamad), נגישות (accessibility), מחסן (storage), סורגים (bars), שקט (quiet), מקלט (shelter), אינטרנט סיבים (fiber_internet). ובמיוחד: **האם דירה מחולקת מתאימה?** (divided_ok: true/false).' },
  { key: 'employment', title: 'תעסוקה וביטחונות', body_text: 'מצב תעסוקה (employment_status — שלח אחד מ: employed/self_employed/student/other = שכיר/עצמאי/סטודנט/אחר; שילוב או משהו אחר → other, ופרט ב-notes), מקום עבודה (employer), תלושי שכר? (has_payslips), צ׳קים לביטחון? (has_security_checks), ערבים? (has_guarantors).' },
  { key: 'notes', title: 'הערות חופשיות', body_text: 'משהו נוסף שחשוב? (notes).' },
]

/** Render topics as the numbered list that goes inside <מה-לאסוף>. `${i}. ${title} — ${body}`. */
export function renderTopics(topics: Array<{ title: string; body_text: string }>): string {
  return topics.map((t, i) => `${i + 1}. ${t.title} — ${t.body_text}`).join('\n')
}

/**
 * Enabled topics for the org, ordered. Falls back to DEFAULT_TOPICS when the org has no rows or the
 * read fails — the bot must never lose its question list. Never throws.
 */
export async function getEnabledTopics(orgId?: string): Promise<InterviewTopic[]> {
  if (!orgId) return DEFAULT_TOPICS
  try {
    const { data, error } = await supabaseService()
      .from('interview_topics')
      .select('key, title, body_text, enabled, sort_order')
      .eq('org_id', orgId)
      .eq('enabled', true)
      .order('sort_order', { ascending: true })
    if (error || !data || data.length === 0) return DEFAULT_TOPICS
    return data.map(t => ({ key: t.key, title: t.title, body_text: t.body_text }))
  } catch {
    return DEFAULT_TOPICS
  }
}
