import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface PropertyData {
  title: string;
  city: string;
  neighborhood: string | null;
  price: number;
  rooms: number | null;
  sqm: number | null;
  description: string | null;
  amenities: any;
  type: string | null;
  condition: string | null;
  available_from: string | null;
  pets_allowed: boolean | null;
  long_term: boolean | null;
}

export interface ProcessedPropertyData {
  ai_title: string;
  ai_description: string;
  ai_highlights: string[];
}

export async function processPropertyForSharing(
  property: PropertyData
): Promise<ProcessedPropertyData> {
  const amenitiesList = property.amenities ? [
    property.amenities.elevator && 'מעלית',
    property.amenities.parking && 'חניה',
    property.amenities.balcony && 'מרפסת',
    property.amenities.mamad && 'ממ״ד',
    property.amenities.air_conditioning && 'מיזוג אוויר',
    property.amenities.furnished && 'מרוהט',
    property.amenities.storage && 'מחסן',
  ].filter(Boolean).join(', ') : 'לא צוין';

  const prompt = `אתה סוכן נדלן מקצועי. קיבלת את הפרטים הבאים על נכס להשכרה:

עיר: ${property.city || 'לא צוין'}
שכונה: ${property.neighborhood || 'לא צוין'}
מחיר: ${property.price ? `₪${property.price.toLocaleString()}` : 'לא צוין'}
חדרים: ${property.rooms || 'לא צוין'}
מ"ר: ${property.sqm || 'לא צוין'}
סוג נכס: ${property.type || 'לא צוין'}
תכונות: ${amenitiesList}
תאריך כניסה: ${property.available_from ? new Date(property.available_from).toLocaleDateString('he-IL') : 'מיידי'}
חיות מחמד: ${property.pets_allowed === true ? 'מותר' : property.pets_allowed === false ? 'לא מותר' : 'לא צוין'}
משך שכירות: ${property.long_term === true ? 'ארוך טווח' : property.long_term === false ? 'קצר טווח' : 'לא צוין'}
תיאור מקורי: ${property.description || 'אין'}

הוראות חשובות לניקוי הנתונים:
1. העיר והשכונה עשויים להכיל מידע מיותר - נקה אותם:
   - הסר מילים כמו "מגורים", "משרדים", "rent", "חיפה -"
   - הסר מספרי בית (למשל "17", "23")
   - הסר מספרי קומה (למשל "קומה 2", "קומה 5")
   - הסר שמות רחובות ספציפיים (למשל "נוגה 17")
   - השאר רק את שם העיר הנקי (למשל "חיפה") ושכונה כללית אם יש (למשל "כרמליה", "הדר")

2. צור כותרת מקצועית בעברית תקנית (40-60 תווים):
   - התחל בסוג הנכס (דירה/דירת גן/פנטהאוס)
   - הוסף מספר חדרים אם יש
   - הוסף עיר נקייה ושכונה כללית
   - דוגמה: "דירת 3 חדרים בחיפה, אזור כרמליה"
   - ללא מחיר, ללא כתובת מדויקת, ללא מילים באנגלית

3. כתוב תיאור מכירתי מקצועי בעברית (2-3 פסקאות, 150-250 מילים):
   - הדגש את היתרונות והתכונות
   - צור אווירה מזמינה
   - אל תכלול פרטי קשר או כתובת מדויקת
   - שמור על טון מקצועי אך חם

4. רשום 4-6 נקודות מפתח קצרות וממוקדות (כל נקודה עד 8 מילים)

החזר את התשובה בפורמט JSON הבא בדיוק:
{
  "title": "הכותרת כאן",
  "description": "התיאור המלא כאן",
  "highlights": ["נקודה 1", "נקודה 2", "נקודה 3", "נקודה 4"]
}

חשוב: אל תכלול במענה שלך שום דבר מלבד ה-JSON. אל תוסיף הסברים או טקסט נוסף.`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'אתה סוכן נדלן מקצועי המתמחה ביצירת תיאורי נכסים מושכים בעברית. תמיד תחזיר רק JSON תקין ללא טקסט נוסף.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' }
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from OpenAI');
    }

    const parsed = JSON.parse(response);

    return {
      ai_title: parsed.title,
      ai_description: parsed.description,
      ai_highlights: parsed.highlights,
    };
  } catch (error) {
    console.error('AI processing error:', error);
    
    // Fallback to basic processing if AI fails
    return {
      ai_title: `${property.type || 'דירה'} ב${property.city}${property.neighborhood ? `, ${property.neighborhood}` : ''}`,
      ai_description: property.description || `${property.type || 'דירה'} יפה ומרווחת להשכרה ב${property.city}.`,
      ai_highlights: [
        property.rooms ? `${property.rooms} חדרים` : null,
        property.sqm ? `${property.sqm} מ"ר` : null,
        amenitiesList !== 'לא צוין' ? amenitiesList : null,
      ].filter(Boolean) as string[],
    };
  }
}

