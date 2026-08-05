-- Adds the file_path column to cashflow_uploads so the original CSV can be stored
-- and retrieved from Supabase Storage (cashflow-files bucket).
ALTER TABLE cashflow_uploads
  ADD COLUMN IF NOT EXISTS file_path TEXT;
