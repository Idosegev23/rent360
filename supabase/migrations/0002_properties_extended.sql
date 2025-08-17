-- Extended properties schema to support scraped data structure
-- Based on JSON structure from external scraping

-- Add new columns to properties table
ALTER TABLE public.properties 
ADD COLUMN IF NOT EXISTS status text,
ADD COLUMN IF NOT EXISTS evacuation_date date,
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS timeline jsonb,
ADD COLUMN IF NOT EXISTS contact_name text,
ADD COLUMN IF NOT EXISTS contact_phone text,
ADD COLUMN IF NOT EXISTS full_text text,
ADD COLUMN IF NOT EXISTS scraped_metadata jsonb,
ADD COLUMN IF NOT EXISTS last_updated_external text;

-- Update amenities structure to be more specific
-- The existing amenities column will continue to work but we'll standardize the structure

-- Add index for better search performance
CREATE INDEX IF NOT EXISTS idx_properties_contact_phone ON public.properties(contact_phone);
CREATE INDEX IF NOT EXISTS idx_properties_status ON public.properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_evacuation ON public.properties(evacuation_date);
CREATE INDEX IF NOT EXISTS idx_properties_full_text ON public.properties USING gin(to_tsvector('hebrew', full_text));

-- Add trigger to update the updated_at when any of the new fields change
CREATE OR REPLACE FUNCTION public.update_property_timestamp()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for the new fields
DROP TRIGGER IF EXISTS trg_properties_updated_at_extended ON public.properties;
CREATE TRIGGER trg_properties_updated_at_extended
  BEFORE UPDATE ON public.properties
  FOR EACH ROW 
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status OR
    OLD.evacuation_date IS DISTINCT FROM NEW.evacuation_date OR
    OLD.description IS DISTINCT FROM NEW.description OR
    OLD.timeline IS DISTINCT FROM NEW.timeline OR
    OLD.contact_name IS DISTINCT FROM NEW.contact_name OR
    OLD.contact_phone IS DISTINCT FROM NEW.contact_phone OR
    OLD.full_text IS DISTINCT FROM NEW.full_text OR
    OLD.scraped_metadata IS DISTINCT FROM NEW.scraped_metadata OR
    OLD.last_updated_external IS DISTINCT FROM NEW.last_updated_external
  )
  EXECUTE FUNCTION public.update_property_timestamp();

-- Add comment for documentation
COMMENT ON COLUMN public.properties.status IS 'Property status from external source (e.g., משופצת, זקוקה לשיפוץ)';
COMMENT ON COLUMN public.properties.evacuation_date IS 'Available from date parsed from evacuation field';
COMMENT ON COLUMN public.properties.description IS 'Detailed description from external source';
COMMENT ON COLUMN public.properties.timeline IS 'Array of timeline events from external source';
COMMENT ON COLUMN public.properties.contact_name IS 'Contact person name from external source';
COMMENT ON COLUMN public.properties.contact_phone IS 'Contact phone from external source';
COMMENT ON COLUMN public.properties.full_text IS 'Full text content for search purposes';
COMMENT ON COLUMN public.properties.scraped_metadata IS 'Metadata from scraping (pageNumber, positionInPage, scrapedAt)';
COMMENT ON COLUMN public.properties.last_updated_external IS 'Last updated timestamp from external source';