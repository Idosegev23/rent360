# Tech Context

## טכנולוגיות
- Next.js 14, React 18, Tailwind, shadcn/ui, Zustand/Redux, RHF+Zod, Recharts.
- Supabase: Postgres, Auth, Storage, Edge Functions, Cron.
- אינטגרציות: GreenAPI (WhatsApp). עתידי: Telegram/Messenger.

## הגדרות סביבתיות
- `GREENAPI_INSTANCE_ID`, `GREENAPI_API_TOKEN_INSTANCE`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE`
- `APP_BASE_URL` (ל‑build/SSR), `TELEGRAM_BOT_TOKEN` (אופציונלי)

## אילוצים
- ביצועים: p95 < 350ms, Matching ל‑1,000 < 1.5s.
- זמינות: MVP 99.5%.
- אבטחה: RLS, JWT עם org_id, הצפנת סודות, Audit.

## פיתוח
- Cursor‑ready; ESLint/TypeScript; בדיקות: Unit/E2E/Contract; Seed לדמו.
