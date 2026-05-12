-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Expand menu_category CHECK to include new categories
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_menu_category_check;
ALTER TABLE items
  ADD CONSTRAINT items_menu_category_check
  CHECK (menu_category IN ('Starter','Main','Drinks','Salsas','Dessert','Other'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Delete ALL existing finished goods (FK-safe)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  finished_ids uuid[];
BEGIN
  SELECT ARRAY(SELECT id FROM items WHERE product_type = 'finished') INTO finished_ids;
  DELETE FROM recipe_ingredients           WHERE item_id        = ANY(finished_ids);
  DELETE FROM recipe_ingredients           WHERE recipe_id IN   (SELECT id FROM recipes WHERE output_item_id = ANY(finished_ids));
  DELETE FROM recipes                      WHERE output_item_id  = ANY(finished_ids);
  DELETE FROM waste_logs                   WHERE item_id        = ANY(finished_ids);
  DELETE FROM stock_movements              WHERE item_id        = ANY(finished_ids);
  DELETE FROM inventory_count_lines        WHERE item_id        = ANY(finished_ids);
  DELETE FROM transfer_lines               WHERE item_id        = ANY(finished_ids);
  DELETE FROM delivery_receipt_lines       WHERE item_id        = ANY(finished_ids);
  DELETE FROM production_batch_consumption WHERE item_id        = ANY(finished_ids);
  DELETE FROM supplier_items               WHERE item_id        = ANY(finished_ids);
  DELETE FROM inventory_levels             WHERE item_id        = ANY(finished_ids);
  DELETE FROM items WHERE product_type = 'finished';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Insert all items from CSV
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO items (name, product_type, is_active, is_purchasable, is_produced, unit_id, gross_price, occasion, menu_category, guest_multiplier)
SELECT
  v.name, 'finished', true, false, true,
  (SELECT id FROM units_of_measure WHERE abbreviation = 'por' LIMIT 1),
  v.gross_price, v.occasion, v.menu_category, v.guest_multiplier
FROM (VALUES
  ('- Chipotle Sour Cream',                    0,    'D',   'Salsas',  0.0),
  ('Agua Fresca',                              55,    'L+D', 'Drinks',  0.0),
  ('Agua Fresca Qu',                           55,    'L+D', 'Drinks',  0.0),
  ('Aperol Spritz',                             9,    'D',   'Drinks',  0.0),
  ('Coca-Cola',                                 4,    'L+D', 'Drinks',  0.0),
  ('Cola-Cola Zero',                            4,    'L+D', 'Drinks',  0.0),
  ('Costilla de Res en Chile y Café',          24,    'L+D', 'Main',    1.0),
  ('Espresso',                                  3,    'L+D', 'Drinks',  0.0),
  ('Fanta',                                     4,    'L+D', 'Drinks',  0.0),
  ('Grauburgunder 0,2L',                        8,    'D',   'Drinks',  0.0),
  ('Ipanema',                                   7,    'D',   'Drinks',  0.0),
  ('Kronenhof Hell 0,3',                       45,    'D',   'Drinks',  0.0),
  ('Kronenhof Hell 0,5',                       64,    'D',   'Drinks',  0.0),
  ('Mezcal Mule',                              13,    'D',   'Drinks',  0.0),
  ('Negra Modelo',                              6,    'D',   'Drinks',  0.0),
  ('Piña Fresca con Chamoy',                   75,    'L+D', 'Starter', 0.0),
  ('Pisco Sour',                               12,    'D',   'Drinks',  0.0),
  ('Saftschorle',                              45,    'L+D', 'Drinks',  0.0),
  ('Softdrink Bo',                              4,    'L+D', 'Drinks',  0.0),
  ('Softdrink Bu',                              4,    'L+D', 'Drinks',  0.0),
  ('Softdrinks BU',                            35,    'L+D', 'Drinks',  0.0),
  ('Softdrinks Qu',                             4,    'L+D', 'Drinks',  0.0),
  ('Sour Cream',                                3,    'D',   'Salsas',  0.0),
  ('Spicy Margarita',                          11,    'D',   'Drinks',  0.0),
  ('Virgin Sinnerman',                          8,    'D',   'Drinks',  0.0),
  ('Wasser Bo',                                 3,    'L+D', 'Drinks',  0.0),
  ('Wasser Bu',                                 3,    'L+D', 'Drinks',  0.0),
  ('Wasser Sprudel 0,25L',                      3,    'L+D', 'Drinks',  0.0),
  ('Wasser Sprudel 0,75L',                      7,    'L+D', 'Drinks',  0.0),
  ('Wasser Still 0,75L',                        7,    'L+D', 'Drinks',  0.0),
  ('Barbacoa',                                  0,    'L+D', 'Other',   0.0),
  ('Chorizo',                                   0,    'L+D', 'Other',   0.0),
  ('Eiscreme',                                  2,    'L+D', 'Dessert', 0.0),
  ('Flavour 2',                                 0,    'L+D', 'Other',   0.0),
  ('Habanero Salsa',                            0,    'L+D', 'Salsas',  0.0),
  ('Medium Well',                               0,    'L+D', 'Other',   0.0),
  ('Medium.',                                   0,    'L+D', 'Other',   0.0),
  ('mild',                                      0,    'L+D', 'Other',   0.0),
  ('Pico de Gallo',                             0,    'L+D', 'Salsas',  0.0),
  ('Salsa Verde',                               0,    'L+D', 'Salsas',  0.0),
  ('scharf',                                    0,    'L+D', 'Other',   0.0),
  ('Tomatensalsa',                              0,    'L+D', 'Salsas',  0.0),
  ('Tropical',                                  0,    'L+D', 'Other',   0.0),
  ('2er Tacos de Birria',                      11,    'L+D', 'Main',    0.5),
  ('2er Tacos Gamba con Salsa Pitaya',         12,    'L+D', 'Main',    0.5),
  ('2er Tacos Mole Rojo',                      11,    'L+D', 'Main',    0.5),
  ('2er Tacos Papa y Chorizo',                 10,    'L+D', 'Main',    0.5),
  ('2good2go',                                  5,    'L+D', 'Other',   0.0),
  ('4er Taco de Birria',                       20,    'L+D', 'Main',    1.0),
  ('4er Tacos Mole Rojo',                      19,    'L+D', 'Main',    1.0),
  ('4er Tacos Papa y Chorizo',                 18,    'L+D', 'Main',    1.0),
  ('5 Tortillas Extra',                         2,    'L+D', 'Other',   0.0),
  ('Al Pastor Burrito',                        13,    'L+D', 'Main',    1.0),
  ('Alambre Al Pastor',                        19,    'L+D', 'Main',    1.0),
  ('Alambre Burrito',                         125,    'L+D', 'Main',    1.0),
  ('Alambre de Pollo',                         19,    'L+D', 'Main',    1.0),
  ('Alambre de Verdura',                       19,    'L+D', 'Main',    1.0),
  ('Avocado Mouse',                             8,    'L+D', 'Other',   0.0),
  ('Barbacoa Bowl',                          1333,    'L+D', 'Main',    1.0),
  ('Barbacoa Burrito',                       1336,    'L+D', 'Main',    1.0),
  ('Basic Bowl',                               10,    'L+D', 'Main',    1.0),
  ('Bowl  Alambre',                           125,    'L+D', 'Main',    1.0),
  ('Bowl  Barbacoa',                          135,    'L+D', 'Main',    1.0),
  ('Bowl Abborrito',                           18,    'L+D', 'Main',    1.0),
  ('Bowl Al Pastor',                           13,    'L+D', 'Main',    1.0),
  ('Bowl Basic',                              105,    'L+D', 'Main',    1.0),
  ('Bowl Chicken',                             13,    'L+D', 'Main',    1.0),
  ('Bowl Chili',                               13,    'L+D', 'Main',    1.0),
  ('Bowl Chili Chicken',                      145,    'L+D', 'Main',    1.0),
  ('Bowl Mole',                                13,    'L+D', 'Main',    1.0),
  ('Bowl Mole Chicken',                       145,    'L+D', 'Main',    1.0),
  ('Bowl Veggie Total',                        13,    'L+D', 'Main',    1.0),
  ('Brownie',                                  65,    'L+D', 'Dessert', 0.0),
  ('Burrito Alambre',                         125,    'L+D', 'Main',    1.0),
  ('Burrito Barbacoa',                       1533,    'L+D', 'Main',    1.0),
  ('Burrito Basic',                           105,    'L+D', 'Main',    1.0),
  ('Burrito Chicken',                         155,    'L+D', 'Main',    1.0),
  ('Burrito Chili',                            13,    'L+D', 'Main',    1.0),
  ('Burrito Chili Chicken',                   145,    'L+D', 'Main',    1.0),
  ('Burrito Cochinita',                        18,    'L+D', 'Main',    1.0),
  ('Burrito Filet',                            21,    'L+D', 'Main',    1.0),
  ('Burrito Mole',                             13,    'L+D', 'Main',    1.0),
  ('Burrito Veggie Total',                     13,    'L+D', 'Main',    1.0),
  ('Chicken Bowl',                            129,    'L+D', 'Main',    1.0),
  ('Chicken Burrito',                          13,    'L+D', 'Main',    1.0),
  ('Chiles Rellenos',                          18,    'L+D', 'Main',    1.0),
  ('Chili Bowl',                               13,    'L+D', 'Main',    1.0),
  ('Chili con Carne',                         125,    'L+D', 'Main',    1.0),
  ('Chilli Burrito',                          125,    'L+D', 'Main',    1.0),
  ('Chipulpotle',                              24,    'L+D', 'Main',    1.0),
  ('Club Mate Bo',                             45,    'L+D', 'Drinks',  0.0),
  ('Cochinita Bowl',                           13,    'L+D', 'Main',    1.0),
  ('Corona',                                   55,    'L+D', 'Drinks',  0.0),
  ('Corralejo Anejo',                           7,    'L+D', 'Drinks',  0.0),
  ('Del Maguey Barril',                         9,    'L+D', 'Drinks',  0.0),
  ('Divers. Food',                              4,    'L+D', 'Other',   0.0),
  ('Doppio',                                   35,    'L+D', 'Drinks',  0.0),
  ('Dos Equis',                                 6,    'L+D', 'Main',    0.0),
  ('Extra Barbacoa Lu',                        35,    'L+D', 'Other',   0.0),
  ('Extra Chicken Lu',                          3,    'L+D', 'Other',   0.0),
  ('Extra Tortilla Lu',                         1,    'L+D', 'Other',   0.0),
  ('Filete de Res en Salsa de Jamaica',        35,    'L+D', 'Main',    1.0),
  ('Gamba extra',                              25,    'L+D', 'Other',   0.0),
  ('Green Garden',                              8,    'L+D', 'Drinks',  0.0),
  ('Gringa Barbacoa',                          75,    'L+D', 'Starter', 0.0),
  ('Habanero Salsa',                            3,    'L+D', 'Salsas',  0.0),
  ('Jever Alkoholfrei',                        45,    'L+D', 'Drinks',  0.0),
  ('Kids Bowl',                                 7,    'L+D', 'Main',    0.5),
  ('Lunch Special Bowl',                      149,    'L+D', 'Main',    1.0),
  ('Lunch Special Burrito',                   149,    'L+D', 'Main',    1.0),
  ('Michelada',                                 7,    'L+D', 'Drinks',  0.0),
  ('Mole Burrito',                             13,    'L+D', 'Main',    1.0),
  ('Mole Rojo con Pollo',                      23,    'L+D', 'Main',    1.0),
  ('Pacifico',                                  6,    'L+D', 'Drinks',  0.0),
  ('Paloma BO',                                 5,    'L+D', 'Drinks',  0.0),
  ('Paloma Grapefruit Limo',                    5,    'L+D', 'Drinks',  0.0),
  ('Salat Basic',                             105,    'L+D', 'Main',    1.0),
  ('Spezi',                                     4,    'L+D', 'Drinks',  0.0),
  ('Taco Fiesta Deluxe',                     2975,    'L+D', 'Main',    1.0),
  ('Taco Mixtos',                              22,    'L+D', 'Main',    1.0),
  ('Tee',                                       3,    'L+D', 'Drinks',  0.0),
  ('Tempranillo 0,2L',                          8,    'L+D', 'Drinks',  0.0),
  ('Torta Ahogada de Cochinita',               21,    'L+D', 'Main',    1.0),
  ('Blue Corn Chorizo Quesadillas',            75,    'L+D', 'Starter', 0.0),
  ('Bowl  Barbacoa Guacamole',               164,    'L+D', 'Main',    1.0),
  ('Bowl Chicken Guacamole',                 159,    'L+D', 'Main',    1.0),
  ('Burrito Barbacoa Guacamole',             164,    'L+D', 'Main',    1.0),
  ('Burrito Chicken Guacamole',              159,    'L+D', 'Main',    1.0),
  ('Burrito Guacamole',                        18,    'L+D', 'Main',    1.0),
  ('Ensalada de Res',                          20,    'L+D', 'Main',    1.0),
  ('Extra Guacamole LM',                       29,    'L+D', 'Other',   0.0),
  ('Guacamole BB',                              4,    'L+D', 'Other',   0.0),
  ('Guacamole BO',                             28,    'L+D', 'Other',   0.0),
  ('Guacamole BU',                             29,    'L+D', 'Other',   0.0),
  ('Guacamole Extra Bo',                       29,    'L+D', 'Other',   0.0),
  ('Guacamole Extra Bu',                       29,    'L+D', 'Other',   0.0),
  ('Guacamole Extra Qu',                       29,    'L+D', 'Other',   0.0),
  ('Guacamole extra*',                          4,    'L+D', 'Other',   0.0),
  ('Guacamole QUE',                            29,    'L+D', 'Other',   0.0),
  ('Lunch Special Quesadilla',               149,    'L+D', 'Main',    1.0),
  ('Mini Quesadillas',                          5,    'L+D', 'Starter', 0.0),
  ('Nachos & Guac Lu',                         55,    'L+D', 'Starter', 0.0),
  ('Nachos & Guacamole',                        8,    'L+D', 'Starter', 0.0),
  ('Nachos & Salsa Lu',                         5,    'L+D', 'Starter', 0.0),
  ('Nachos Guacamole',                         55,    'L+D', 'Starter', 0.0),
  ('Nachos Guacamole BO',                      55,    'L+D', 'Starter', 0.0),
  ('Nachos Salsa',                              5,    'L+D', 'Starter', 0.0),
  ('Pica Pica',                                19,    'L+D', 'Starter', 0.0),
  ('Quesadilla Al Pastor',                     13,    'L+D', 'Main',    1.0),
  ('Quesadilla Alambre',                      125,    'L+D', 'Main',    1.0),
  ('Quesadilla Barbacoa',                    1325,    'L+D', 'Main',    1.0),
  ('Quesadilla Barbacoa Guacamole',           164,    'L+D', 'Main',    1.0),
  ('Quesadilla Chicken',                     1294,    'L+D', 'Main',    1.0),
  ('Quesadilla Chili Chicken',               145,    'L+D', 'Main',    1.0),
  ('Quesadilla Cochinita Pibil',               13,    'L+D', 'Main',    1.0),
  ('Quesadilla Mole',                        1275,    'L+D', 'Main',    1.0),
  ('Vorspeisensalat',                           8,    'L+D', 'Starter', 0.0)
) AS v(name, gross_price, occasion, menu_category, guest_multiplier);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- SELECT menu_category, COUNT(*) FROM items WHERE product_type = 'finished'
-- GROUP BY menu_category ORDER BY menu_category;
-- ─────────────────────────────────────────────────────────────────────────────
