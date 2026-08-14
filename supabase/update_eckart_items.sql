-- Update item list for Eckart Fleischwaren
-- Run in Supabase SQL Editor

DO $$
DECLARE
  v_supplier_id uuid;
  v_item_id     uuid;
BEGIN

  -- Find Eckart supplier (matches any name containing 'Eckart')
  SELECT id INTO v_supplier_id
  FROM suppliers
  WHERE name ILIKE '%eckart%'
  LIMIT 1;

  IF v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Eckart supplier not found';
  END IF;

  -- Remove all existing supplier_items for Eckart
  DELETE FROM supplier_items WHERE supplier_id = v_supplier_id;

  -- Helper: insert item if it doesn't exist, then link to Eckart
  -- 1. Hähnchenschenkel 300g je Stk/ 6kg pro Karton
  INSERT INTO items (name) VALUES ('Hähnchenschenkel 300g je Stk/ 6kg pro Karton')
  ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_item_id FROM items WHERE name = 'Hähnchenschenkel 300g je Stk/ 6kg pro Karton';
  INSERT INTO supplier_items (supplier_id, item_id, unit_price, package_size, is_preferred)
  VALUES (v_supplier_id, v_item_id, 0, 'Karton', true);

  -- 2. Querrippe Rind portioniert (1 KG)
  INSERT INTO items (name) VALUES ('Querrippe Rind portioniert (1 KG)')
  ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_item_id FROM items WHERE name = 'Querrippe Rind portioniert (1 KG)';
  INSERT INTO supplier_items (supplier_id, item_id, unit_price, package_size, is_preferred)
  VALUES (v_supplier_id, v_item_id, 0, 'KG', true);

  -- 3. Rinder Nacken
  INSERT INTO items (name) VALUES ('Rinder Nacken')
  ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_item_id FROM items WHERE name = 'Rinder Nacken';
  INSERT INTO supplier_items (supplier_id, item_id, unit_price, package_size, is_preferred)
  VALUES (v_supplier_id, v_item_id, 0, 'Kg', true);

  -- 4. Rindfleisch gewürfelt 4x4 cm (1 KG)
  INSERT INTO items (name) VALUES ('Rindfleisch gewürfelt 4x4 cm (1 KG)')
  ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_item_id FROM items WHERE name = 'Rindfleisch gewürfelt 4x4 cm (1 KG)';
  INSERT INTO supplier_items (supplier_id, item_id, unit_price, package_size, is_preferred)
  VALUES (v_supplier_id, v_item_id, 0, 'KG', true);

  -- 5. Schweinegeschnetzeltes a.d. Lachs
  INSERT INTO items (name) VALUES ('Schweinegeschnetzeltes a.d. Lachs')
  ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_item_id FROM items WHERE name = 'Schweinegeschnetzeltes a.d. Lachs';
  INSERT INTO supplier_items (supplier_id, item_id, unit_price, package_size, is_preferred)
  VALUES (v_supplier_id, v_item_id, 0, 'Kg', true);

  -- 6. Schweinenacken gewürfelt 4x4 cm (1 KG)
  INSERT INTO items (name) VALUES ('Schweinenacken gewürfelt 4x4 cm (1 KG)')
  ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_item_id FROM items WHERE name = 'Schweinenacken gewürfelt 4x4 cm (1 KG)';
  INSERT INTO supplier_items (supplier_id, item_id, unit_price, package_size, is_preferred)
  VALUES (v_supplier_id, v_item_id, 0, 'KG', true);

  RAISE NOTICE 'Done — 6 items linked to supplier %', v_supplier_id;
END $$;
