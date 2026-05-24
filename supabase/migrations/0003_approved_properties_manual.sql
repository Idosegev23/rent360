-- Track who approved a property and which flow approved it (manual phone-call vs questionnaire)
alter table public.approved_properties
  add column if not exists approved_by uuid references public.users(id) on delete set null,
  add column if not exists approval_method text not null default 'questionnaire';

alter table public.approved_properties
  drop constraint if exists approved_properties_approval_method_check;
alter table public.approved_properties
  add constraint approved_properties_approval_method_check
  check (approval_method in ('questionnaire', 'manual'));
