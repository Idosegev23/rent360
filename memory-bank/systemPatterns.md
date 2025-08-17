# System Patterns

## ארכיטקטורה
- Frontend: Next.js (App Router), Tailwind + shadcn/ui, Zustand/Redux, RHF+Zod.
- Backend: Supabase (Postgres/Auth/Storage/Edge/Cron), Vercel APIs אופציונלי.
- הודעות: GreenAPI ל‑WhatsApp, עתידי: Messenger/Telegram.

## דפוסים מרכזיים
- הפרדת ארגונים עם `org_id`; בפועל RLS דרך מיפוי `auth.uid()` לטבלת `users` (פונקציה `user_org_id()`).
- API חיצוני עם Idempotency-Key, Scopes, Rate Limit (בשלבי MVP חלקי).
- מנוע התאמה עם משקלים דינמיים ושכבות נורמליזציה (v1 שלד; התאמות מנוהלות בטבלת `matches`).
- Templates placeholders `{{...}}` + Preview; שליחה דרך GreenAPI + רישום בטבלת `messages`.
- Inbox/Threads מתוכנן; כרגע רישום הודעות וחיווי בסיסי בדשבורד.

## מבנה פרויקט
- `app/*` למסכים ו‑API Routes, `components/*` לרכיבים, `lib/*` ללוגיקה.
- `supabase/migrations` + `policies` לסכימות ו‑RLS.
- `openapi/openapi.yaml` כסכמת חוזה (שלד קיים).
