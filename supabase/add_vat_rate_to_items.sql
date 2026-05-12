-- Add a standalone vat_rate column to items so VAT can be set
-- independently of menu_category.
-- Values are stored as decimals: 0.07 = 7%, 0.19 = 19%

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS vat_rate numeric(5,4) DEFAULT NULL;

-- Seed from existing category logic so all current rows are populated
UPDATE items
SET vat_rate = CASE WHEN menu_category = 'Drinks' THEN 0.19 ELSE 0.07 END
WHERE product_type = 'finished'
  AND vat_rate IS NULL;
