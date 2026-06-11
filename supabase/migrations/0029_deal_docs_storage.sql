-- Private bucket 'deal-docs' (created via storage API: public=false) for uploaded contracts/IDs/payslips,
-- served through short-lived signed URLs. documents.storage_path holds the object path for uploaded files
-- (vs documents.url for external links).
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS storage_path text;
