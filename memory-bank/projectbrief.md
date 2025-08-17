# Project Brief – Rent360

מערכת לניהול נכסי שכירות ולידים: איסוף, ניהול, התאמה ושליחת הודעות, עם בעלות מלאה על קוד ודאטה. פרויקט מותאם Cursor, מובייל‑פירסט, נתמך ע"י Supabase ו‑GreenAPI ל‑WhatsApp, וכולל קליטה ממקורות חיצוניים (API/CSV/טלגרם בהמשך).

## מטרות
- לספק זרימה מלאה: יבוא → ניקוי/ולידציה → התאמה → שליחה ומעקב → Inbox.
- שקיפות בהתאמה: ציון 0–100 עם Breakdown ברור.
- תפעול הודעות אמין: מדיניות Quiet Hours, מניעת כפילויות, סטטוסים ועדכונים.
- אבטחה ופרטיות: הפרדה לפי ארגונים (RLS), JWT עם org_id, Audit Trail.
- Developer UX: עץ פרויקט ברור, בדיקות, OpenAPI, תיעוד חי.

## היקף (MVP)
- מסכים: דשבורד, נכסים, לידים, התאמות, Inbox, Admin.
- יבוא CSV (אשף 3 שלבים) + External API ל‑leads/properties/imports.
- התאמה v1 עם משקלים דינמיים (Settings).
- שליחת WhatsApp דרך GreenAPI + סטטוסים בטבלת messages.
- סכימת Supabase + RLS + אינדקסים.

## Out of Scope (ל‑MVP)
- סנכרון CRM מתקדם, אוטומציות SLA עמוקות, דוחות מתקדמים.
- ערוצים נוספים (Messenger/Telegram) מעבר ל‑POC/שלד.

## משתמשי יעד ותפקידים
- Owner/Admin/Agent/Viewer עם הרשאות מדורגות.

## קריטריוני קבלה (תקציר)
- יבוא CSV עם דוח שגיאות והיסטוריה.
- מנוע התאמה מציג Score + Breakdown.
- שליחת WhatsApp נרשמת ונצפית ב‑Inbox.
- External API פעיל עם Idempotency + Rate Limit.
- RLS מפריד ארגונים במלואו.
