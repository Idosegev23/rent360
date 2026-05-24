/**
 * Server-side text improver for property descriptions / titles.
 *
 * Shared by two callers:
 *  - POST /api/v1/ai/improve-text — explicit "✨ Improve with AI" button in the
 *    add-property form. Returns the improved text for preview.
 *  - POST /api/v1/properties/manual-add — auto-cleans the description before
 *    inserting, so messy pasted text never lands in the DB.
 *
 * Hard guarantees (baked into the prompt):
 *  - Never invents facts. Never changes numbers.
 *  - Drops anything unclear instead of guessing.
 *  - Returns plain Hebrew text (no markdown, no emoji).
 *  - Fails open: if OpenAI is down / errors, callers fall back to the raw text.
 */

import OpenAI from 'openai'

const MODEL = process.env.OPENAI_AGENT_MODEL || 'gpt-5.4'

const SYSTEM_DESCRIPTION = `אתה עורך טקסטים מקצועי בעברית של חברת תיווך דירות.
המשימה: לקבל טקסט גולמי של תיאור דירה (מהעתקה מפרסום/הודעה/הערות מהירות) ולהפוך אותו לטקסט מקצועי, נעים לקריאה, מסודר.

חוקים קשיחים:
- אל תוסיף עובדות חדשות. עבוד אך ורק עם המידע שיש בטקסט המקורי.
- אם משהו לא ברור (סתום, חסר, סותר) — השאיר את זה בחוץ. אל תמציא.
- אל תשנה מספרים: מחיר, חדרים, מ"ר, קומה, תאריך — אם הם בטקסט המקורי, הם נשארים בדיוק כפי שהיו.
- עברית כתובה ונקייה, ללא שגיאות. אבל לא רשמית מדי — טון של חבר מקצועי.
- 3-5 משפטים, מקסימום 6.
- בלי markdown, בלי בולטים, בלי כותרות. רק טקסט זורם.
- בלי אמוג'י.
- אל תפתח ב"שלום" / "הנכס היפה הזה" / "אנו שמחים להציג" — תיכנס ישר לעניין.

החזר רק את הטקסט המשופר, ללא שום הסבר או תוספת.`

const SYSTEM_TITLE = `אתה עורך כותרות לפרסומי דירות בעברית.
המשימה: לקבל טקסט גולמי ולהפוך אותו לכותרת קצרה ותוססת (5-10 מילים).
חוקים:
- אל תמציא מספרים שלא היו בטקסט המקורי.
- כותרת אחת בלבד, בלי סימני פיסוק מיותרים בסוף.
- בלי אמוג'י, בלי markdown.

החזר רק את הכותרת.`

let _client: OpenAI | null = null
function client(): OpenAI {
  if (_client) return _client
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY missing')
  _client = new OpenAI({ apiKey })
  return _client
}

export type ImproveKind = 'description' | 'title'

/** Strict: throws if the API errors. Callers that want fail-open use `improveTextOrFallback`. */
export async function improveText(text: string, kind: ImproveKind = 'description'): Promise<string> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('empty input')
  if (trimmed.length > 4000) throw new Error('too long')
  const instructions = kind === 'title' ? SYSTEM_TITLE : SYSTEM_DESCRIPTION
  const r: any = await (client() as any).responses.create({
    model: MODEL,
    store: false,
    instructions,
    input: [{ role: 'user', content: [{ type: 'input_text', text: trimmed }] }],
  })
  const out = extractOutputText(r).trim()
  if (!out) throw new Error('empty response from model')
  return out
}

/** Fail-open variant: returns the original text on any error. Used in hot paths like manual-add. */
export async function improveTextOrFallback(text: string, kind: ImproveKind = 'description'): Promise<{ text: string; improved: boolean }> {
  const trimmed = text.trim()
  if (!trimmed) return { text: '', improved: false }
  // Skip improvement for very short text — there's nothing to clean.
  if (trimmed.length < 15) return { text: trimmed, improved: false }
  try {
    const improved = await improveText(trimmed, kind)
    return { text: improved, improved: true }
  } catch (err) {
    console.error('[text-improve] fail-open:', err instanceof Error ? err.message : String(err))
    return { text: trimmed, improved: false }
  }
}

function extractOutputText(response: any): string {
  if (typeof response?.output_text === 'string' && response.output_text) return response.output_text
  const output = response?.output
  if (Array.isArray(output)) {
    const parts: string[] = []
    for (const item of output) {
      if (item?.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.type === 'output_text' && typeof c.text === 'string') parts.push(c.text)
        }
      }
    }
    return parts.join('\n')
  }
  return ''
}
