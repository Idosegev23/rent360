-- 0005_whatsapp_recalibration.sql
-- Bot identity + Responses API state + opt-out infrastructure + pgvector RAG.
-- Applied 2026-05-20 via Supabase MCP.

-- Enable pgvector for RAG over properties and messages
create extension if not exists vector;

-- threads: OpenAI Responses API state + opt-out tracking
alter table public.threads
  add column if not exists openai_response_id text,
  add column if not exists opted_out_at timestamptz;

-- properties: outreach gating + RAG embedding
alter table public.properties
  add column if not exists outreach_blocked boolean not null default false,
  add column if not exists outreach_skip_reason text,
  add column if not exists embedding vector(1536),
  add column if not exists embedding_source_hash text;

-- messages: AI-turn dedup (the orchestrator coalesces inbound bursts) + RAG over conversation history
alter table public.messages
  add column if not exists processed_at timestamptz,
  add column if not exists embedding vector(1536);

-- pgvector indexes (ivfflat with cosine)
do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_properties_embedding') then
    execute 'create index idx_properties_embedding on public.properties using ivfflat (embedding vector_cosine_ops) with (lists = 100)';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_messages_embedding') then
    execute 'create index idx_messages_embedding on public.messages using ivfflat (embedding vector_cosine_ops) with (lists = 100)';
  end if;
end $$;

-- Suppression list for opted-out phones (org-scoped uniqueness)
create table if not exists public.whatsapp_suppression (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  phone text not null,
  reason text,
  source text,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_whatsapp_suppression_org_phone on public.whatsapp_suppression(org_id, phone);

-- Template seed updates: rewrite v1 + add reengage + admin alert
update public.whatsapp_templates
set body_template = E'{{1}}, היי 👋\n\nזה הבוט של רנט 360. ראיתי את המודעה שלך לדירה ב{{2}} ורציתי להציע משהו:\n\nאנחנו עוזרים לבעלי דירות להשכיר בלי דמי תיווך — מטפלים בסינון השוכרים, חוזה וביטחונות.\n\nנדבר רגע על הדירה שלך?',
    param_names = '["first_name","street"]'::jsonb,
    updated_at = now()
where name = 'landlord_outreach_v1' and language = 'he';

insert into public.whatsapp_templates (name, language, category, status, body_template, param_names)
values (
  'landlord_reengage_v1',
  'he',
  'utility',
  'pending',
  E'{{1}}, רק לוודא שלא פספסתי אותך — אם כבר לא רלוונטי לתיווך לנכס שלך ב{{2}}, אענה בקצרה ונסגור בנעימים. אם כן רלוונטי — אני כאן 🙂',
  '["first_name","street"]'::jsonb
)
on conflict (name, language) do nothing;

insert into public.whatsapp_templates (name, language, category, status, body_template, param_names)
values (
  'admin_handoff_alert_v1',
  'he',
  'utility',
  'pending',
  E'🤝 לקוח מבקש לדבר עם בן אדם\n\nלקוח: {{1}} ({{2}})\nנכס: {{3}}\nסיבה: {{4}}\n\nלחץ על הכפתור למטה לפתיחת השיחה.',
  '["landlord_name","landlord_phone","property_title","reason","thread_id"]'::jsonb
)
on conflict (name, language) do nothing;
