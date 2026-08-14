-- Update item list for Eckart Fleischwaren
-- Run in Supabase SQL Editor

DO $$
DECLARE
  v_supplier_id uuid;
  v_item_id     uuid;

  -- Item definitions: (name, package_size)
  items_data text[][] := ARRAY[
    ARRAY['Hähnchenschenkel 300g je Stk/ 6kg pro Karton', 'Karton'],
    ARRAY['Querrippe Rind portioniert (1 KG)',             'KG'],
    ARRAY['Rinder Nacken',                                 'Kg'],
    ARRAY['Rindfleisch gewürfelt 4x4 cm (1 KG)',           'KG'],
    ARRAY['Schweinegeschnetzeltes a.d. Lachs',             'Kg'],
    ARRAY['Schweinenacken gewürfelt 4x4 cm (1 KG)',        'KG']
  ];
  rec text[];
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

  FOREACH rec SLICE 1 IN ARRAY items_data
  LOOP
    -- Get existing item or insert new one
    SELECT id INTO v_item_id FROM items WHERE name = rec[1] LIMIT 1;

    IF v_item_id IS NULL THEN
      INSERT INTO items (name) VALUES (rec[1]) RETURNING id INTO v_item_id;
    END IF;

    -- Link item to Eckart
    INSERT INTO supplier_items (supplier_id, item_id, unit_price, package_size, is_preferred)
    VALUES (v_supplier_id, v_item_id, 0, rec[2], true);
  END LOOP;

  RAISE NOTICE 'Done — 6 items linked to supplier %', v_supplier_id;
END $$;
