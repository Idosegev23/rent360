-- Offboard Daria (dashkin10@gmail.com) — left the company.
-- Deactivate her staff `users` row so she can't log in to org-scoped APIs, stops receiving
-- WhatsApp staff alerts (staffAlertPhones filters on is_active + receives_alerts), and can no
-- longer be assigned properties/leads. Also unassign anything currently routed to her so work
-- doesn't silently sit with a disabled user. Login UX is separately blocked by the client-side
-- ALLOWED list in app/auth/callback/page.tsx and by her removal from the seed-team roster.
-- Idempotent + keyed on email; the row is kept (deactivated) as a historical record, not deleted.

UPDATE public.users
SET is_active = false,
    receives_alerts = false,
    handles_properties = false
WHERE lower(email) = 'dashkin10@gmail.com';

-- Release any property/thread assignments that point at her (back to unassigned for reassignment).
UPDATE public.properties p
SET assigned_agent_user_id = NULL
FROM public.users u
WHERE p.assigned_agent_user_id = u.id
  AND lower(u.email) = 'dashkin10@gmail.com';

UPDATE public.threads t
SET assigned_to = NULL
FROM public.users u
WHERE t.assigned_to = u.id
  AND lower(u.email) = 'dashkin10@gmail.com';
