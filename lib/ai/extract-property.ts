/**
 * Extract a full structured property record from one raw Hebrew/English blob.
 *
 * Use case: employee gets a WhatsApp message / Yad2 post / scribbled note,
 * pastes it into a single textarea, and the form auto-fills.
 *
 * Strict contract: the model MUST return only JSON, and only fields it can
 * confidently infer. Anything ambiguous → omitted (frontend leaves the
 * existing form value alone). This keeps employees in control.
 */

import OpenAI from 'openai'

const MODEL = process.env.OPENAI_AGENT_MODEL || 'gpt-5.4'

const SYSTEM = `אתה מחלץ מידע מובנה ממודעות / הודעות / הערות על דירות להשכרה בעברית או באנגלית.

החזר JSON בלבד, ללא markdown, ללא הסבר, ללא טקסט נוסף. השתמש בסכמה הבאה. השמט שדה אם אינך יכול להסיק אותו בביטחון מתוך הטקסט — אל תנחש.

{
  "contact_name": string,         // שם פרטי בלבד אם אפשר
  "contact_phone": string,        // ספרות בלבד, בפורמט ישראלי 05XXXXXXXX או +972XXXXXXXXX
  "city": string,
  "neighborhood": string,
  "street": string,               // כולל מספר בית אם מופיע
  "floor": number,                // קומה
  "rooms": number,                // עשרוני מותר (2.5)
  "sqm": number,                  // מ"ר
  "price": number,                // שכר דירה חודשי בש"ח
  "available_from": string,       // YYYY-MM-DD
  "description": string,          // סיכום נקי 3-5 משפטים, עברית תקנית, ללא markdown/אמוג'י
  "amenities": {
    "elevator": boolean,
    "parking": boolean,
    "balcony": boolean,
    "airConditioner": boolean,
    "storage": boolean,
    "mamad": boolean
  },
  "pets_allowed": boolean,
  "smokers_allowed": boolean
}

חוקי חילוץ:
- אל תמציא ערכים. אם פרט לא נאמר במפורש בטקסט — השמט אותו לחלוטין.
- amenities: כלול רק מפתחות שהוזכרו בטקסט (true אם הוזכר חיובי, false אם הוזכר במפורש שלא). אל תניח false לכל השאר — פשוט השמט.
- ספרות מספריות הן מספרים (rooms: 2.5, לא "2.5").
- תאריכים בעברית — המר ל-YYYY-MM-DD לפי השנה הנוכחית אם חסרה ("1 ביולי" → "2026-07-01"). אם השנה כבר עברה, השתמש בשנה הבאה.
- טלפון — נקה רווחים/מקפים. שמור על הקידומת המקורית (05XX או +972).
- description — בנה סיכום נקי בעברית מהטקסט המקורי, 3-5 משפטים, בלי אמוג'י, בלי לפתוח ב"שלום". אם אין מספיק תוכן להפיק תיאור — השמט.
- אם מוזכר מחיר בלשון "פלוס ארנונה" / "כולל כל החשבונות" — שמור רק את המספר ב-price, ההסבר ייכנס ל-description.
- אל תכלול מפתחות עם null או "" — השמט לגמרי אם אין ערך.

החזר אך ורק את ה-JSON.`

export type ExtractedProperty = Partial<{
  contact_name: string
  contact_phone: string
  city: string
  neighborhood: string
  street: string
  floor: number
  rooms: number
  sqm: number
  price: number
  available_from: string
  description: string
  amenities: Partial<{
    elevator: boolean
    parking: boolean
    balcony: boolean
    airConditioner: boolean
    storage: boolean
    mamad: boolean
  }>
  pets_allowed: boolean
  smokers_allowed: boolean
}>

let _client: OpenAI | null = null
function client(): OpenAI {
  if (_client) return _client
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY missing')
  _client = new OpenAI({ apiKey })
  return _client
}

export async function extractPropertyFromText(text: string): Promise<{ data: ExtractedProperty; rawJson: string }> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('empty input')
  if (trimmed.length > 8000) throw new Error('input too long (max 8000 chars)')

  const r: any = await (client() as any).responses.create({
    model: MODEL,
    store: false,
    instructions: SYSTEM,
    input: [{ role: 'user', content: [{ type: 'input_text', text: trimmed }] }],
  })
  const raw = extractOutputText(r).trim()
  const cleaned = stripJsonFence(raw)

  let parsed: any
  try {
    parsed = JSON.parse(cleaned)
  } catch (err) {
    throw new Error(`model returned non-JSON: ${cleaned.slice(0, 200)}`)
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('extracted payload is not an object')

  // Light defensive cleanup
  const out: ExtractedProperty = {}
  for (const key of [
    'contact_name', 'contact_phone', 'city', 'neighborhood', 'street',
    'available_from', 'description',
  ] as const) {
    const v = parsed[key]
    if (typeof v === 'string' && v.trim()) (out as any)[key] = v.trim()
  }
  for (const key of ['floor', 'rooms', 'sqm', 'price'] as const) {
    const v = parsed[key]
    if (typeof v === 'number' && Number.isFinite(v)) (out as any)[key] = v
    else if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) (out as any)[key] = Number(v)
  }
  for (const key of ['pets_allowed', 'smokers_allowed'] as const) {
    if (typeof parsed[key] === 'boolean') (out as any)[key] = parsed[key]
  }
  if (parsed.amenities && typeof parsed.amenities === 'object') {
    const am: Record<string, boolean> = {}
    for (const k of ['elevator', 'parking', 'balcony', 'airConditioner', 'storage', 'mamad']) {
      if (typeof parsed.amenities[k] === 'boolean') am[k] = parsed.amenities[k]
    }
    if (Object.keys(am).length) out.amenities = am as NonNullable<ExtractedProperty['amenities']>
  }
  return { data: out, rawJson: cleaned }
}

function stripJsonFence(s: string): string {
  // Some models wrap output in ```json … ``` — strip it.
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
