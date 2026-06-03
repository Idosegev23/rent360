/**
 * Generate a short personal "hook" line for each property — used in the
 * `landlord_outreach_v2_rich` template's {{6}} parameter.
 *
 * Pipeline, in order of preference (first that produces usable output wins):
 *  1. **Vision** — gpt-5.4 looks at up to 5 property photos and writes a
 *     specific, grounded observation (~80 chars). Requires real images.
 *  2. **Description analysis** — pulls one striking detail from the
 *     scraped description text.
 *  3. **Amenity highlight** — if a notable amenity combo exists (e.g.,
 *     elevator + parking + balcony), produces a fact-based line.
 *  4. **null** — no usable personalization. Caller falls back to the
 *     simpler `landlord_outreach_v2_basic` template (5 vars, no hook).
 *
 * Result is stored in `properties.scraped_metadata.ai_personalization` so
 * we never re-pay vision cost for the same property. Re-run only when the
 * property's images or description change.
 */

import OpenAI from 'openai'
import { supabaseService } from '../supabase'

const MODEL = process.env.OPENAI_AGENT_MODEL || 'gpt-5.4'
const MAX_VISION_IMAGES = 5
const MAX_LINE_CHARS = 100

export type PersonalizationSource = 'vision' | 'description' | 'amenity'

export type Personalization = {
  line: string
  source: PersonalizationSource
  confidence: 'high' | 'medium' | 'low'
  generated_at: string
}

let _client: OpenAI | null = null
function client(): OpenAI {
  if (_client) return _client
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY missing')
  _client = new OpenAI({ apiKey })
  return _client
}

const VISION_SYSTEM = `אתה כותב משפט קצר אחד (עד 120 תווים) על דירה להשכרה, על סמך תמונות שלה. המשפט יישלח לבעל הדירה כחלק מהודעת פנייה ראשונה.

המטרה: ליצור אפקט של "באמת הסתכלו על הדירה שלי, לא רק סרקו את המספר". זה חייב להישמע אישי ומבוסס, לא קלישאה.

חוקי-ברזל (אסור לחרוג):
1. תאר רק מה שאתה רואה בוודאות. אל תקרא לחפצים שמות אלא אם הם חד-משמעיים בתמונה.
2. אם אין משהו ספציפי שווה לציון בתמונות — החזר NULL. עדיף NULL מאשר תיאור כללי או מומצא.
3. אל תמציא: צבעים, מצב, תקופת שיפוץ, רהיטים שלא רואים, נוף שלא רואים.
4. אסור: סופרלטיבים ריקים ("נראה מדהים", "פשוט מושלם"). תיאור עובדתי בלבד.
5. משפט אחד, עד 120 תווים, עברית פשוטה, ללא אמוג'י, ללא markdown.
6. מבנה חובה — שני חלקים: (א) פרט קונקרטי שראית, ואז (ב) מקף "—" וזווית קצרה שמחברת את הפרט לביקוש מצד שוכרים או לערך לבעל הנכס (בדיוק כמו בדוגמאות הטובות). משפט שהוא רק תיאור ("ראינו מרפסת גדולה עם נוף") בלי החלק השני — אסור, גנרי מדי. או שמוסיפים זווית, או מחזירים NULL.
7. פתח ב"ראינו"/"ראיתי" כדי להבהיר שזה מבוסס תמונה.

דוגמאות לפלט טוב:
- "ראינו את המטבח עם השיש הכהה — סטייל שמושך שוכרים שמחפשים סיים נקי."
- "המרפסת עם הנוף הזה היא נקודת מכירה — חבל לבזבז אותה על שוכר רנדומלי."
- "ראינו אור טבעי טוב בסלון — דירה שמצטלמת טוב מתפנה מהר."
- "ראינו ריצוף חדש וקירות לבנים — רמת הגימור מבוקשת חזק באזור."
- "המטבח הפתוח לסלון הוא הסידור שמשפחות צעירות מחפשות."

דוגמאות שאסור להחזיר:
- "דירה יפה מאוד" (גנרי)
- "המטבח החדש" (אם לא ברור מהתמונה שהמטבח חדש)
- "הנוף לים" (אם לא רואים ים)
- "הריהוט המודרני" (אם אין ריהוט בתמונה או שלא ברור שהוא מודרני)

תפורמט הפלט שלך כ-JSON עם שני שדות:
{
  "line": string או null,
  "confidence": "high" / "medium" / "low"
}

confidence=high — יש לפחות 2-3 תמונות שמתעדות בבירור את מה שתיארת.
confidence=medium — תיארת על סמך תמונה אחת ברורה.
confidence=low — אתה מתלבט, התיאור גבולי. במקרה זה החזר line=null.

החזר JSON בלבד, ללא markdown.`

const DESCRIPTION_SYSTEM = `קיבלת תיאור דירה גולמי (מ-יד2/וואטסאפ/הערות). חלץ ממנו פרט אחד חזק וייחודי (אם יש), ונסח משפט קצר אחד שיכול להופיע בהודעת פנייה ראשונה לבעל הדירה.

חוקים:
1. רק פרט שמופיע בטקסט המקורי. אל תמציא.
2. תעדיף פרטים יוצאי דופן: שיפוץ ברמה גבוהה, מאפיין נדיר (חיות מחמד מותרים, ממ"ד פרטי), הזדמנות (קומה גבוהה עם נוף).
3. אם הטקסט גנרי בלבד ("דירה משופצת, מטבח חדש") — החזר NULL.
4. עד 120 תווים, עברית, ללא אמוג'י/markdown.
5. פתח ב"ראינו ש..." או "צוין במודעה ש..." כדי להבהיר את המקור.
6. מבנה חובה — שני חלקים: פרט ייחודי, ואז מקף "—" וזווית קצרה שמחברת אותו לביקוש/ערך (כמו "— בדיוק מה ששוכרים אצלנו מחפשים"). תיאור יבש בלי זווית — אסור.

החזר JSON:
{ "line": string או null, "confidence": "high" / "medium" / "low" }

החזר JSON בלבד.`

export async function generatePersonalization(opts: {
  images?: string[]
  description?: string | null
  fullText?: string | null
  amenities?: Record<string, boolean> | null
}): Promise<Personalization | null> {
  // 1. Try vision
  const usableImages = (opts.images || []).filter(u => typeof u === 'string' && u.length > 0).slice(0, MAX_VISION_IMAGES)
  if (usableImages.length > 0) {
    const visionResult = await tryVision(usableImages)
    if (visionResult) return { ...visionResult, source: 'vision', generated_at: new Date().toISOString() }
  }

  // 2. Try description
  const descText = (opts.description || opts.fullText || '').trim()
  if (descText.length >= 30) {
    const descResult = await tryDescription(descText)
    if (descResult) return { ...descResult, source: 'description', generated_at: new Date().toISOString() }
  }

  // 3. Amenity-based fallback (deterministic, no AI cost)
  const amenityLine = amenityBasedHook(opts.amenities || {})
  if (amenityLine) {
    return { line: amenityLine, source: 'amenity', confidence: 'medium', generated_at: new Date().toISOString() }
  }

  return null
}

async function tryVision(imageUrls: string[]): Promise<{ line: string; confidence: 'high' | 'medium' | 'low' } | null> {
  try {
    const content: Array<Record<string, unknown>> = [
      { type: 'input_text', text: `הנה ${imageUrls.length} תמונות של הדירה. נסח משפט אחד לפי החוקים.` },
      ...imageUrls.map(url => ({ type: 'input_image', image_url: url })),
    ]
    const r: any = await (client() as any).responses.create({
      model: MODEL,
      store: false,
      instructions: VISION_SYSTEM,
      input: [{ role: 'user', content }],
    })
    return parseLineResponse(extractOutputText(r))
  } catch (err) {
    console.error('[property-vision] vision failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}

async function tryDescription(text: string): Promise<{ line: string; confidence: 'high' | 'medium' | 'low' } | null> {
  try {
    const r: any = await (client() as any).responses.create({
      model: MODEL,
      store: false,
      instructions: DESCRIPTION_SYSTEM,
      input: [{ role: 'user', content: [{ type: 'input_text', text: text.slice(0, 4000) }] }],
    })
    return parseLineResponse(extractOutputText(r))
  } catch (err) {
    console.error('[property-vision] description failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}

function amenityBasedHook(amenities: Record<string, boolean>): string | null {
  // Conservative deterministic rules — only when a clearly notable combo exists.
  const has = (k: string) => amenities[k] === true
  if (has('elevator') && has('parking') && has('balcony')) {
    return 'ראינו שיש מעלית, חניה ומרפסת — קומבינציה שזוגות צעירים ומשפחות מחפשים חזק.'
  }
  if (has('mamad')) {
    return 'ראינו שיש ממ"ד — נדיר באזור הזה ושוכרים שמים על זה דגש.'
  }
  if (has('parking') && has('balcony')) {
    return 'ראינו חניה ומרפסת — בקשה רבה בקרב שוכרים שלנו באזור.'
  }
  if (has('elevator')) {
    return 'ראינו שיש מעלית — חשוב לחלק נכבד מהשוכרים, במיוחד מבוגרים יותר.'
  }
  return null
}

function parseLineResponse(raw: string): { line: string; confidence: 'high' | 'medium' | 'low' } | null {
  const text = stripJsonFence(raw).trim()
  if (!text) return null
  let parsed: any
  try { parsed = JSON.parse(text) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  const line = typeof parsed.line === 'string' ? parsed.line.trim() : null
  const confidence = ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'medium'
  if (!line || line.toLowerCase() === 'null' || confidence === 'low') return null
  if (line.length > MAX_LINE_CHARS) return { line: line.slice(0, MAX_LINE_CHARS - 1) + '…', confidence }
  return { line, confidence }
}

function stripJsonFence(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return m ? m[1]!.trim() : s
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

// ---------- Persistence -----------------------------------------------------

/** Generate + persist the personalization line for a property. Skips if recent + same images. */
export async function generateAndStorePersonalization(propertyId: string, opts?: { force?: boolean }): Promise<{ generated: boolean; existing: boolean; line: string | null }> {
  const sb = supabaseService()
  const { data: p } = await sb
    .from('properties')
    .select('id, images, description, full_text, amenities, scraped_metadata')
    .eq('id', propertyId)
    .maybeSingle()
  if (!p) return { generated: false, existing: false, line: null }

  const existing = (p.scraped_metadata && typeof p.scraped_metadata === 'object'
    ? (p.scraped_metadata as any).ai_personalization
    : null) as Personalization | null
  if (!opts?.force && existing && existing.line) {
    return { generated: false, existing: true, line: existing.line }
  }

  const result = await generatePersonalization({
    images: Array.isArray(p.images) ? p.images : [],
    description: p.description,
    fullText: p.full_text,
    amenities: p.amenities as any,
  })
  if (!result) {
    // Still write a "no_personalization" marker so we don't retry every cron tick.
    const newMeta = { ...(p.scraped_metadata && typeof p.scraped_metadata === 'object' ? p.scraped_metadata : {}), ai_personalization: { line: null, source: null, attempted_at: new Date().toISOString() } }
    await sb.from('properties').update({ scraped_metadata: newMeta as any }).eq('id', propertyId)
    return { generated: false, existing: false, line: null }
  }

  const newMeta = { ...(p.scraped_metadata && typeof p.scraped_metadata === 'object' ? p.scraped_metadata : {}), ai_personalization: result }
  await sb.from('properties').update({ scraped_metadata: newMeta as any }).eq('id', propertyId)
  return { generated: true, existing: false, line: result.line }
}

export function getPersonalizationFromMeta(scrapedMetadata: unknown): string | null {
  if (!scrapedMetadata || typeof scrapedMetadata !== 'object') return null
  const p = (scrapedMetadata as any).ai_personalization
  if (!p || typeof p !== 'object') return null
  return typeof p.line === 'string' && p.line.trim() ? p.line.trim() : null
}

/** Fire-and-forget wrapper for the hot path. */
export function generatePersonalizationInBackground(propertyId: string): void {
  generateAndStorePersonalization(propertyId).catch(err => {
    console.error(`[property-vision] background ${propertyId}:`, err instanceof Error ? err.message : String(err))
  })
}
