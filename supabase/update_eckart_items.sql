-- Update item list for Eckart Fleischwaren
-- Run in Supabase SQL Editor

DO $$
DECLARE
  v_supplier_id uuid;
  v_item_id     uuid;

  item_names text[] := ARRAY[
    'Hähnchenschenkel 300g je Stk/ 6kg pro Karton',
    'Querrippe Rind portioniert (1 KG)',
    'Rinder Nacken',
    'Rindfleisch gewürfelt 4x4 cm (1 KG)',
    'Schweinegeschnetzeltes a.d. Lachs',
    'Schweinenacken gewürfelt 4x4 cm (1 KG)'
  ];
  item_name text;
BEGIN

  -- Find Eckart supplier
  SELECT id INTO v_supplier_id
  FROM suppliers
  WHERE name ILIKE '%eckart%'
  LIMIT 1;

  IF v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Eckart supplier not found';
  END IF;

  -- Remove all existing supplier_items for Eckart
  DELETE FROM supplier_items WHERE supplier_id = v_supplier_id;

  FOREACH item_name IN ARRAY item_names
  LOOP
    -- Get existing item or insert new one
    SELECT id INTO v_item_id FROM items WHERE name = item_name LIMIT 1;

    IF v_item_id IS NULL THEN
      INSERT INTO items (name) VALUES (item_name) RETURNING id INTO v_item_id;
    END IF;

    -- Link item to Eckart (package_size and unit_price left blank for manual entry)
    INSERT INTO supplier_items (supplier_id, item_id, unit_price, package_size, is_preferred)
    VALUES (v_supplier_id, v_item_id, 0, NULL, true);
  END LOOP;

  RAISE NOTICE 'Done — 6 items linked to supplier %', v_supplier_id;
END $$;
