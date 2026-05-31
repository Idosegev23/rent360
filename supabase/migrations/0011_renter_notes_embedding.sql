-- Renters get the same embedding treatment as properties: their free-text
-- "notes" field is embedded so the matcher can score semantic similarity
-- against the property's description/full_text vector. Empty notes →
-- empty vector (NULL) → matcher treats the dimension as "didn't ask".
ALTER TABLE renters
  ADD COLUMN IF NOT EXISTS notes_embedding vector(1536),
  ADD COLUMN IF NOT EXISTS notes_embedding_hash text;

-- ivfflat index for cosine search. Same lists value as properties.
CREATE INDEX IF NOT EXISTS renters_notes_embedding_idx
  ON renters USING ivfflat (notes_embedding vector_cosine_ops)
  WITH (lists = 100);

COMMENT ON COLUMN renters.notes_embedding IS
  'text-embedding-3-small vector of the renter''s notes field. NULL = no notes / not embedded yet.';
