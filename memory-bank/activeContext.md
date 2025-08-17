# Active Context

## פוקוס נוכחי
- אפליקציה רצה עם Next.js + Tailwind RTL + shadcn style, אינטגרציית Supabase מלאה (DB/Auth/Storage), ו‑GreenAPI.
- דשבורד MVP: KPIים, "צריך טיפול", גרפים דינמיים לפי פילוחים (ערים/חדרים/סטטוס הודעות) עם API אגרגציות.
- נכסים: רשימה אמיתית מה‑DB; כרטיס נכס מעוצב עם תמונה; דף נכס מלא (פרטים/עריכה/התאמות/העלאת תמונות ל‑bucket).
- לידים: טופס יצירה; התאמות לנכס כולל כפתור "שלח הודעה" פרסונלית דרך GreenAPI ונרשמת ב‑messages.
- **נוסף**: טבלת נכסים מורחבת עם תמיכה בנתונים מוכנים מ-scraping - סטטוס, תאריך פינוי, פרטי קשר, timeline של עדכונים, טקסט מלא, metadata.

## החלטות פעילות
- אימוץ Supabase+RLS כבסיס הרשאות מרובי ארגונים.
- אימוץ GreenAPI לערוץ הודעות ראשון.
- Mobile‑first עם RTL מלא; שמירה על EN‑ready.
- שימוש ב‑middleware לבקרת גישה לפי קוקי Supabase; מיפוי org_id מתוך טבלת users (auth.uid()).
- Storage: bucket public `property-images` לתמונות נכסים; העלאה מהלקוח ועדכון `properties.images`.

## צעדים הבאים
- הוספת Template Picker להודעות + עורך טקסט פרסונלי; ניהול תבניות ב‑`settings`.
- UI לפילטרים מתקדמים בדשבורד ושמירת Layout/Preferences למשתמש.
- מסך `admin/users` לניהול משתמשים/תפקידים; דגל `must_change_password` ב‑onboarding.
- Import Wizard (3 שלבים) + דוחות; Matches גלובלי; Inbox מאוחד בסיסי.
