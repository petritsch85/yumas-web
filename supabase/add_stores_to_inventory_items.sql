-- Add stores column to inventory_items
-- NULL / missing rows → visible in all stores (handled by default)
-- Populated array → visible only in the listed stores

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS stores TEXT[] NOT NULL
  DEFAULT ARRAY['Eschborn','Taunus','Westend'];

-- Backfill existing rows (all current items belong to all stores)
UPDATE inventory_items
SET stores = ARRAY['Eschborn','Taunus','Westend']
WHERE stores IS NULL;
