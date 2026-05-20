-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1: Add ZK to inventory_sections
-- ─────────────────────────────────────────────────────────────────────────────

-- ZK-specific sections (not visible in the three restaurant stores)
INSERT INTO inventory_sections (name, stores, sort_order) VALUES
  ('Kühlhaus Links',  ARRAY['ZK'], 10),
  ('Kühlhaus Rechts', ARRAY['ZK'], 20),
  ('Tiefkühlhaus',    ARRAY['ZK'], 30),
  ('Non-Food 1',      ARRAY['ZK'], 50),
  ('Non-Food 2',      ARRAY['ZK'], 60),
  ('Food Lager',      ARRAY['ZK'], 70)
ON CONFLICT (name) DO NOTHING;

-- Tiefkühler already exists for the 3 stores — add ZK to it
UPDATE inventory_sections
SET stores = array_append(stores, 'ZK')
WHERE name = 'Tiefkühler' AND NOT ('ZK' = ANY(stores));

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2: Helper macro — add ZK to an existing item + set its ZK sort order
-- Usage: UPDATE ... SET stores = zk_add_store(stores), store_sort_orders = store_sort_orders || zk_ord
-- ─────────────────────────────────────────────────────────────────────────────
-- We use a plain DO block to avoid needing a function.

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3: KÜHLHAUS LINKS items
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE items TEXT[][] := ARRAY[
  -- name,                          section,           unit,                sort_order
  ARRAY['Pico de Gallo',           'Kühlhaus Links',  '1/2 GN',            '10'],
  ARRAY['Guacamole',               'Kühlhaus Links',  '1/6 GN groß',       '20'],
  ARRAY['Sour Cream',              'Kühlhaus Links',  '1/6 GN groß',       '30'],
  ARRAY['Tomatensalsa',            'Kühlhaus Links',  '1/6 GN groß',       '40'],
  ARRAY['Maissalsa',               'Kühlhaus Links',  '1/6 GN groß',       '50'],
  ARRAY['Chipotle SourCream',      'Kühlhaus Links',  'Beutel (2.0kg)',     '60'],
  ARRAY['Kartoffel Würfel',        'Kühlhaus Links',  'Beutel (3.0kg)',     '70'],
  ARRAY['Pozole',                  'Kühlhaus Links',  'Beutel (1.0kg)',     '80'],
  ARRAY['Crema Nogada',            'Kühlhaus Links',  'Beutel (1.0kg)',     '90'],
  ARRAY['Salsa Habanero',          'Kühlhaus Links',  'Beutel (1.5kg)',     '100'],
  ARRAY['Alambre - Zwiebel',       'Kühlhaus Links',  'Beutel (2.0kg)',     '110'],
  ARRAY['Salsa Verde',             'Kühlhaus Links',  'Beutel (2.0kg)',     '120'],
  ARRAY['Schoko-Avocado Mousse',   'Kühlhaus Links',  'Glas',               '130']
]; i TEXT[];
BEGIN FOREACH i SLICE 1 IN ARRAY items LOOP
  -- Update if exists
  UPDATE inventory_items
  SET stores = CASE WHEN 'ZK' = ANY(stores) THEN stores ELSE array_append(stores, 'ZK') END,
      store_sort_orders = store_sort_orders || jsonb_build_object('ZK', i[4]::int)
  WHERE name = i[1];
  -- Insert if not exists
  INSERT INTO inventory_items (name, section, unit, sort_order, stores, store_sort_orders)
  SELECT i[1], i[2], i[3], i[4]::int, ARRAY['ZK'], jsonb_build_object('ZK', i[4]::int)
  WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE name = i[1]);
END LOOP; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 4: KÜHLHAUS RECHTS items
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE items TEXT[][] := ARRAY[
  ARRAY['Käse Gouda',                'Kühlhaus Rechts', 'Beutel (5.0kg)',     '10'],
  ARRAY['Gouda Scheiben Gringa',     'Kühlhaus Rechts', 'Packung',            '20'],
  ARRAY['Salsa de Jamaica',          'Kühlhaus Rechts', 'Beutel (0.5kg)',     '30'],
  ARRAY['Vinaigrette',               'Kühlhaus Rechts', 'Behälter (1.0l)',    '40'],
  ARRAY['Honig Sesam / Senf',        'Kühlhaus Rechts', 'Behälter (1.0l)',    '50'],
  ARRAY['Salsa für Pulpo',           'Kühlhaus Rechts', 'Beutel (0.5kg)',     '60'],
  ARRAY['Schärfemix',                'Kühlhaus Rechts', 'Beutel (0.5kg)',     '70'],
  ARRAY['Salsa Pitaya',              'Kühlhaus Rechts', 'Beutel (0.5kg)',     '80'],
  ARRAY['Humo Salsa',                'Kühlhaus Rechts', 'Flasche',            '90'],
  ARRAY['Fuego Salsa',               'Kühlhaus Rechts', 'Flasche',            '100'],
  ARRAY['Rote Zwiebeln eingelegt',   'Kühlhaus Rechts', '1/6 GN groß',       '110'],
  ARRAY['Chiles Poblanos',           'Kühlhaus Rechts', 'Stück',              '120']
]; i TEXT[];
BEGIN FOREACH i SLICE 1 IN ARRAY items LOOP
  UPDATE inventory_items
  SET stores = CASE WHEN 'ZK' = ANY(stores) THEN stores ELSE array_append(stores, 'ZK') END,
      store_sort_orders = store_sort_orders || jsonb_build_object('ZK', i[4]::int)
  WHERE name = i[1];
  INSERT INTO inventory_items (name, section, unit, sort_order, stores, store_sort_orders)
  SELECT i[1], i[2], i[3], i[4]::int, ARRAY['ZK'], jsonb_build_object('ZK', i[4]::int)
  WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE name = i[1]);
END LOOP; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 5: TIEFKÜHLHAUS items
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE items TEXT[][] := ARRAY[
  ARRAY['Barbacoa',                  'Tiefkühlhaus',    '1/6 GN groß',       '10'],
  ARRAY['Cochinita',                 'Tiefkühlhaus',    '1/6 GN groß',       '20'],
  ARRAY['Mole',                      'Tiefkühlhaus',    '1/6 GN groß',       '30'],
  ARRAY['Chili con Carne',           'Tiefkühlhaus',    '1/6 GN groß',       '40'],
  ARRAY['Salsa für Costilla de Res', 'Tiefkühlhaus',    'Beutel (2L)',        '50'],
  ARRAY['Brownie',                   'Tiefkühlhaus',    'Blech',              '60'],
  ARRAY['Pulpo',                     'Tiefkühlhaus',    'Beutel (150g)',      '70'],
  ARRAY['Chorizo',                   'Tiefkühlhaus',    'Beutel (1.0kg)',     '80'],
  ARRAY['Carne Vegetal',             'Tiefkühlhaus',    'Beutel (1.0kg)',     '90'],
  ARRAY['Marinade Chicken',          'Tiefkühlhaus',    'Beutel (1.0kg)',     '100'],
  ARRAY['Bohnencreme',               'Tiefkühlhaus',    'Beutel (2.5kg)',     '110'],
  ARRAY['Birria',                    'Tiefkühlhaus',    'Beutel (2.0kg)',     '120'],
  ARRAY['Salsa Birria',              'Tiefkühlhaus',    'Beutel (1.0kg)',     '130'],
  ARRAY['Blau Mais Tortillas 15cm',  'Tiefkühlhaus',    'Beutel (40 Stk)',    '140'],
  ARRAY['Rinderfilet Steak',         'Tiefkühlhaus',    'Stück (200g)',       '150'],
  ARRAY['Filetspitzen',              'Tiefkühlhaus',    'Beutel (100g)',      '160'],
  ARRAY['Hähnchenkeule (ganz)',      'Tiefkühlhaus',    'Beutel (2 Stück)',   '170'],
  ARRAY['Queso Cotija',              'Tiefkühlhaus',    'Pack (1.0kg)',       '180'],
  ARRAY['Queso Oaxaca',              'Tiefkühlhaus',    'Pack (1.0kg)',       '190'],
  ARRAY['Queso Chihuahua',           'Tiefkühlhaus',    'Pack (1.0kg)',       '200'],
  ARRAY['Mole Rojo',                 'Tiefkühlhaus',    'Beutel (2.0kg)',     '210'],
  ARRAY['Salsa Torta',               'Tiefkühlhaus',    'Beutel (1.0kg)',     '220'],
  ARRAY['Karotten karamellisiert',   'Tiefkühlhaus',    'Beutel (10 Stück)', '230'],
  ARRAY['Marinade Al Pastor',        'Tiefkühlhaus',    'Beutel (1.0kg)',     '240'],
  ARRAY['Zwiebeln karamellisiert',   'Tiefkühlhaus',    'Beutel (1.0kg)',     '250'],
  ARRAY['Costilla de Res',           'Tiefkühlhaus',    'Beutel (4 Portion)', '260'],
  ARRAY['Füllung Nogada',            'Tiefkühlhaus',    'Beutel (2.0kg)',     '270'],
  ARRAY['Tortillas 30cm',            'Tiefkühlhaus',    'Karton',             '280'],
  ARRAY['Weizen Tortillas 20cm',     'Tiefkühlhaus',    'Karton',             '290'],
  ARRAY['Weizen Tortillas 12cm',     'Tiefkühlhaus',    'Karton',             '300'],
  ARRAY['Mais Tortillas 12cm',       'Tiefkühlhaus',    'Beutel (50 Stk)',    '310'],
  ARRAY['Ciabatta',                  'Tiefkühlhaus',    'Stück',              '320'],
  ARRAY['Alambre - Paprika Streifen','Tiefkühlhaus',    'Beutel (2.5kg)',     '330'],
  ARRAY['Gambas',                    'Tiefkühlhaus',    'Beutel (1.0kg)',     '340']
]; i TEXT[];
BEGIN FOREACH i SLICE 1 IN ARRAY items LOOP
  UPDATE inventory_items
  SET stores = CASE WHEN 'ZK' = ANY(stores) THEN stores ELSE array_append(stores, 'ZK') END,
      store_sort_orders = store_sort_orders || jsonb_build_object('ZK', i[4]::int)
  WHERE name = i[1];
  INSERT INTO inventory_items (name, section, unit, sort_order, stores, store_sort_orders)
  SELECT i[1], i[2], i[3], i[4]::int, ARRAY['ZK'], jsonb_build_object('ZK', i[4]::int)
  WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE name = i[1]);
END LOOP; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 6: TIEFKÜHLER (existing section — just Carlota de Limon)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE inventory_items
SET stores = CASE WHEN 'ZK' = ANY(stores) THEN stores ELSE array_append(stores, 'ZK') END,
    store_sort_orders = store_sort_orders || '{"ZK": 10}'::jsonb
WHERE name = 'Carlota de Limon';

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 7: NON-FOOD 1 items (ZK-only cleaning / disposables)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE items TEXT[][] := ARRAY[
  ARRAY['Topfschwamm',           'Non-Food 1', 'Packung (10Stk)',   '10'],
  ARRAY['Toilettenpapier',       'Non-Food 1', 'Packung',           '20'],
  ARRAY['Reinigungshandschuhe',  'Non-Food 1', 'Packung (2Stk)',    '30'],
  ARRAY['Backpapier',            'Non-Food 1', 'Rolle',             '40'],
  ARRAY['Alufolie',              'Non-Food 1', 'Rolle',             '50'],
  ARRAY['Müllbeutel Blau 120L',  'Non-Food 1', '120L Rolle',        '60'],
  ARRAY['Müllbeutel Schwarz 30L','Non-Food 1', '30L Rolle',         '70'],
  ARRAY['Spüli',                 'Non-Food 1', 'Flasche',           '80'],
  ARRAY['Spülmaschine Salz',     'Non-Food 1', 'Beutel',            '90'],
  ARRAY['Essigessenz',           'Non-Food 1', 'Flasche',           '100'],
  ARRAY['Edelstahlschwamm',      'Non-Food 1', 'Packung (10Stk)',   '110']
]; i TEXT[];
BEGIN FOREACH i SLICE 1 IN ARRAY items LOOP
  UPDATE inventory_items
  SET stores = CASE WHEN 'ZK' = ANY(stores) THEN stores ELSE array_append(stores, 'ZK') END,
      store_sort_orders = store_sort_orders || jsonb_build_object('ZK', i[4]::int)
  WHERE name = i[1];
  INSERT INTO inventory_items (name, section, unit, sort_order, stores, store_sort_orders)
  SELECT i[1], i[2], i[3], i[4]::int, ARRAY['ZK'], jsonb_build_object('ZK', i[4]::int)
  WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE name = i[1]);
END LOOP; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 8: NON-FOOD 2 items
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE items TEXT[][] := ARRAY[
  ARRAY['B200S',                    'Non-Food 2', 'Kanister',          '10'],
  ARRAY['B100N',                    'Non-Food 2', 'Kanister',          '20'],
  ARRAY['F420E',                    'Non-Food 2', 'Kanister',          '30'],
  ARRAY['F8500',                    'Non-Food 2', 'Kanister',          '40'],
  ARRAY['Universal Reiniger',       'Non-Food 2', 'Kanister',          '50'],
  ARRAY['Grillreiniger',            'Non-Food 2', 'Kanister',          '60'],
  ARRAY['Sanitärreiniger',          'Non-Food 2', 'Kanister',          '70'],
  ARRAY['Glasreiniger',             'Non-Food 2', 'Kanister',          '80'],
  ARRAY['Kalkreiniger',             'Non-Food 2', 'Kanister',          '90'],
  ARRAY['Desinfektionsreiniger',    'Non-Food 2', 'Kanister',          '100'],
  ARRAY['Laminat-Parket-Reiniger',  'Non-Food 2', 'Kanister',          '110'],
  ARRAY['Kleine Togo Tüte',         'Non-Food 2', 'Karton',            '120'],
  ARRAY['Handschuhe M',             'Non-Food 2', 'Packung',           '130'],
  ARRAY['Handschuhe L',             'Non-Food 2', 'Packung',           '140'],
  ARRAY['Dressingsbecher Schale',   'Non-Food 2', '50er Pack',         '150'],
  ARRAY['Dressingsbecher Deckel',   'Non-Food 2', '50er Pack',         '160'],
  ARRAY['Große Togo Tüte',          'Non-Food 2', 'Karton',            '170'],
  ARRAY['Kleine Bowl togo Schale',  'Non-Food 2', 'Packungen (40 Stk)','180'],
  ARRAY['Kleine Bowl togo Deckel',  'Non-Food 2', 'Packungen (40 Stk)','190'],
  ARRAY['Große Bowl togo Schale',   'Non-Food 2', 'Packungen (40 Stk)','200'],
  ARRAY['Große Bowl togo Deckel',   'Non-Food 2', 'Packungen (40 Stk)','210'],
  ARRAY['Blaue Rolle',              'Non-Food 2', 'Rolle',             '220'],
  ARRAY['Trayliner Papier',         'Non-Food 2', 'Karton',            '230'],
  ARRAY['Zig-Zag Papier',           'Non-Food 2', 'Karton',            '240'],
  ARRAY['Weiße Serviette',          'Non-Food 2', 'Karton',            '250'],
  ARRAY['Schwarze Serviette',       'Non-Food 2', 'Karton',            '260']
]; i TEXT[];
BEGIN FOREACH i SLICE 1 IN ARRAY items LOOP
  UPDATE inventory_items
  SET stores = CASE WHEN 'ZK' = ANY(stores) THEN stores ELSE array_append(stores, 'ZK') END,
      store_sort_orders = store_sort_orders || jsonb_build_object('ZK', i[4]::int)
  WHERE name = i[1];
  INSERT INTO inventory_items (name, section, unit, sort_order, stores, store_sort_orders)
  SELECT i[1], i[2], i[3], i[4]::int, ARRAY['ZK'], jsonb_build_object('ZK', i[4]::int)
  WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE name = i[1]);
END LOOP; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 9: FOOD LAGER items
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE items TEXT[][] := ARRAY[
  ARRAY['Nachos',                   'Food Lager', 'Karton (12 Beutel)', '10'],
  ARRAY['Schwarze Bohnen',          'Food Lager', 'Sack (5kg)',         '20'],
  ARRAY['Limettensaft (750ml Metro)','Food Lager','Flasche',            '30'],
  ARRAY['Rapsöl',                   'Food Lager', 'Kanister (10L)',     '40'],
  ARRAY['Oliven entkernt',          'Food Lager', 'Glas',              '50'],
  ARRAY['Zucker',                   'Food Lager', 'Packung (1.0kg)',    '60'],
  ARRAY['Tajin',                    'Food Lager', 'Packung',            '70'],
  ARRAY['Reis',                     'Food Lager', 'Beutel (1kg)',       '80'],
  ARRAY['Salz',                     'Food Lager', 'Eimer (10kg)',       '90'],
  ARRAY['H-Milch 3,5%',             'Food Lager', 'Flasche',           '100'],
  ARRAY['Mehrwegbowl',              'Food Lager', 'Stück',             '110'],
  ARRAY['Pfeffer',                  'Food Lager', 'Packung',           '120'],
  ARRAY['Pfeffer geschrotet',       'Food Lager', 'Packung',           '130']
]; i TEXT[];
BEGIN FOREACH i SLICE 1 IN ARRAY items LOOP
  UPDATE inventory_items
  SET stores = CASE WHEN 'ZK' = ANY(stores) THEN stores ELSE array_append(stores, 'ZK') END,
      store_sort_orders = store_sort_orders || jsonb_build_object('ZK', i[4]::int)
  WHERE name = i[1];
  INSERT INTO inventory_items (name, section, unit, sort_order, stores, store_sort_orders)
  SELECT i[1], i[2], i[3], i[4]::int, ARRAY['ZK'], jsonb_build_object('ZK', i[4]::int)
  WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE name = i[1]);
END LOOP; END $$;
