-- 0004_whatsapp_conversations.sql
-- Extend the messaging schema to support AI-driven WhatsApp landlord conversations
-- via Meta Cloud API. Applied via Supabase MCP on 2026-05-20.

-- Extend threads to be WhatsApp-aware
alter table public.threads
  add column if not exists channel text not null default 'whatsapp',
  add column if not exists phone text,
  add column if not exists last_inbound_at timestamptz,
  add column if not exists last_outbound_at timestamptz,
  add column if not exists status text not null default 'active',
  add column if not exists ai_summary text,
  add column if not exists assigned_to uuid references public.users(id) on delete set null;

create index if not exists idx_threads_org_phone on public.threads(org_id, phone);
create index if not exists idx_threads_status on public.threads(org_id, status, last_message_at desc);

-- Extend messages with Meta metadata + AI metadata
alter table public.messages
  add column if not exists external_id text,
  add column if not exists meta_message_type text,
  add column if not exists template_name text,
  add column if not exists template_params jsonb,
  add column if not exists media_url text,
  add column if not exists ai_metadata jsonb;

create index if not exists idx_messages_thread_created on public.messages(thread_id, created_at desc);
create unique index if not exists idx_messages_external_id_uniq on public.messages(external_id) where external_id is not null;

-- conversation_alerts: drives the Inbox + Telegram pings
create table if not exists public.conversation_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  thread_id uuid not null references public.threads(id) on delete cascade,
  type text not null check (type in ('handoff','inbound_after_hours','closed_won','urgent','new_lead')),
  payload jsonb,
  read_at timestamptz,
  sent_telegram_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_alerts_org_unread on public.conversation_alerts(org_id, created_at desc) where read_at is null;

-- whatsapp_templates: catalog of approved Meta templates
create table if not exists public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  language text not null default 'he',
  category text not null check (category in ('marketing','utility','authentication','service')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','paused','deleted')),
  body_template text not null,
  param_names jsonb not null default '[]'::jsonb,
  meta_template_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_whatsapp_templates_name_lang on public.whatsapp_templates(name, language);

-- Seed initial outreach template (status pending until Meta approves)
insert into public.whatsapp_templates (name, language, category, status, body_template, param_names)
values (
  'landlord_outreach_v1',
  'he',
  'marketing',
  'pending',
  E'היי {{1}}! זה זיו מרנט 360 👋\n\nראיתי שפרסמת דירה ב{{2}} — ויש לי כרגע {{3}} שוכרים פעילים שמחפשים בדיוק באזור הזה.\n\nאצלנו אין דמי תיווך לבעל הנכס — אנחנו מסננים שוכרים איכותיים, מתאמים ביקורים, ועוזרים בחוזה. רוצה שאספר לך עוד?',
  '["first_name","street","active_renters_count"]'::jsonb
)
on conflict (name, language) do nothing;
