-- Add language preference to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en'
  CHECK (language IN ('en', 'de', 'es'));

-- Set Jairo to Spanish
UPDATE profiles SET language = 'es' WHERE full_name = 'Jairo';

-- Verify
SELECT id, full_name, role, language FROM profiles ORDER BY full_name;
