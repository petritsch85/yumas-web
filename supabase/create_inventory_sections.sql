-- Create inventory_sections table
-- Sections are now DB-backed so new ones can be added per-store from the UI.
CREATE TABLE IF NOT EXISTS inventory_sections (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  stores     TEXT[]      NOT NULL DEFAULT ARRAY['Eschborn','Taunus','Westend'],
  sort_order INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique name per section (globally — stores array controls visibility)
CREATE UNIQUE INDEX IF NOT EXISTS inventory_sections_name_key ON inventory_sections (name);

-- Seed the five default sections
INSERT INTO inventory_sections (name, sort_order, stores) VALUES
  ('Kühlhaus',    10, ARRAY['Eschborn','Taunus','Westend']),
  ('Tiefkühler',  20, ARRAY['Eschborn','Taunus','Westend']),
  ('Trockenware', 30, ARRAY['Eschborn','Taunus','Westend']),
  ('Regale',      40, ARRAY['Eschborn','Taunus','Westend']),
  ('Lager',       50, ARRAY['Eschborn','Taunus','Westend'])
ON CONFLICT (name) DO NOTHING;

-- RLS
ALTER TABLE inventory_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sections_select" ON inventory_sections;
DROP POLICY IF EXISTS "sections_insert" ON inventory_sections;
DROP POLICY IF EXISTS "sections_update" ON inventory_sections;
DROP POLICY IF EXISTS "sections_delete" ON inventory_sections;

CREATE POLICY "sections_select" ON inventory_sections FOR SELECT TO authenticated USING (true);
CREATE POLICY "sections_insert" ON inventory_sections FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "sections_update" ON inventory_sections FOR UPDATE TO authenticated USING (true);
CREATE POLICY "sections_delete" ON inventory_sections FOR DELETE TO authenticated USING (true);
