-- Junction table: which locations each supplier delivers to
CREATE TABLE IF NOT EXISTS supplier_locations (
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (supplier_id, location_id)
);

ALTER TABLE supplier_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can read supplier_locations"
  ON supplier_locations FOR SELECT TO authenticated USING (true);

CREATE POLICY "Auth users can insert supplier_locations"
  ON supplier_locations FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Auth users can delete supplier_locations"
  ON supplier_locations FOR DELETE TO authenticated USING (true);
