# Progress

## מה עובד (עודכן)
- אפליקציה רצה מקומית (Next 14, TS, Tailwind RTL), דשבורד עם KPIים וגרפים, רשימת נכסים ולידים, דף נכס מלא.
- Supabase: סכימת Core, RLS, Users mapping ל‑org_id, Storage bucket לתמונות נכסים.
- הודעות: שליחת WhatsApp דרך GreenAPI, רישום בטבלת messages.
- Auth: Supabase Auth, Login/Change Password, Middleware.
- **נכסים מורחבים**: תמיכה בנתונים מוכנים מ-scraping (סטטוס, תאריך פינוי, קשר, timeline, גלריה, metadata).
- **Inbound Webhook**: נוסף מסלול OpenAPI ל‑`/webhooks/leads-ingest` + פונקציית Edge `leads-ingest` (אימות Bearer, נרמול טלפון E.164, פרסינג price_range, מיפוי העדפות, upsert ל‑leads, דה‑דופ לפי (org_id, source_id, phone)).
- **לידים מוואטסאפ**: טבלת `whatsapp_leads`, API endpoint `/api/v1/whatsapp/leads` לקליטת JSON מבוט, מנוע התאמה מתקדם `WhatsAppMatcher`, UI לניהול לידים מוואטסאפ עם חיפוש התאמות.

## מה נשאר
- Template Editor והגדרות ברמת ארגון; ניהול תבניות הודעה.
- Import Wizard מלא + דוחות + **אינטגרציה עם נתונים מוכנים מ-scraping**.
- Matches גלובלי; Inbox מאוחד.
- מסך Admin לניהול משתמשים/תפקידים/מפתחות API.
 - הנפקת טוקן ייעודי ל‑LeadMeCMS, פרסום URL והדרכת קונפיג.

## נוסף לאחרונה (השדות החדשים)
- **מיגרציה 0002**: השדות החדשים בטבלת properties - status, evacuation_date, contact_name/phone, timeline, full_text, scraped_metadata.
- **טיפוסים**: ExtendedProperty, ScrapedPropertyData + convertScrapedToProperty.
- **PropertyCard מעודכן**: הצגת סטטוס, פרטי קשר, אמצעי נוחות מפורטים, מספר תמונות, זמן עדכון.
- **דף נכס מורחב**: גלריה אינטראקטיבית, timeline עדכונים, פרטי קשר קליקים, metadata מלא.
- **property-import.ts**: כלים לייבוא נתונים מוכנים מ-JSON לטבלה.
- **גלריה אינטראקטיבית**: תמונה ראשית + תמונות קטנות לחיצה, State management עם React.
- **ייבוא נתונים אמיתיים**: 3 נכסים מקרית ביאליק עם כל הנתונים המורחבים במקום נתוני דמה.
- **דשבורד מודרני**: עיצוב חדש עם גרפים קומפקטיים, KPI cards וצבעי מותג.
- **דף לידים מודרני**: רשימה עם פילטרים, חיפוש, סטטיסטיקות וכרטיסי לידים מפורטים.
- **דף נכסים מודרני**: שפה עיצובית זהה עם סטטיסטיקות, פילטרים מתקדמים, מצבי תצוגה (רשת/רשימה).
- **דף התאמות מתקדם**: מנוע התאמות חכם עם אחוזי התאמה, דרישות חובה מפילות, פירוט מלא של סיבות.

## סוגיות ידועות
- שליחת הודעות: חסר Rate-limit/Quiet Hours בפועל (קונספט קיים).
- הגדרות התאמה: ממשק למשקלים דינמיים עדיין לא ממומש.

## סטטוס
- מצב: MVP בסיסי פעיל; ממשיכים להעמיק פיצ'רים וניהול.

- סקפולד + API + DB + Storage + Auth הוקמו; גרפים ודפים מרכזיים עובדים.
