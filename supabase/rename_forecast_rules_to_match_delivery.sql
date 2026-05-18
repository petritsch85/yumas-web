-- Rename forecast rule item names to match delivery_run_lines item names
UPDATE usage_forecast_rules SET item_name = 'Alambre - Paprika Streifen' WHERE item_name = 'Alambre Paprika';
UPDATE usage_forecast_rules SET item_name = 'Alambre - Zwiebel'          WHERE item_name = 'Alambre Zwiebel';
UPDATE usage_forecast_rules SET item_name = 'Chili con Carne'            WHERE item_name = 'Chili';
UPDATE usage_forecast_rules SET item_name = 'Käse Gouda'                 WHERE item_name = 'Gouda';
UPDATE usage_forecast_rules SET item_name = 'Honig Sesam / Senf'         WHERE item_name = 'Honig Sesam';
UPDATE usage_forecast_rules SET item_name = 'Fuego Salsa'                WHERE item_name = 'Salsa Fuego';
UPDATE usage_forecast_rules SET item_name = 'Humo Salsa'                 WHERE item_name = 'Salsa Humo';
UPDATE usage_forecast_rules SET item_name = 'Schärfemix'                 WHERE item_name = 'Schaerfemix';
UPDATE usage_forecast_rules SET item_name = 'Tortillas 30cm'             WHERE item_name = 'Tortilla 30cm';
UPDATE usage_forecast_rules SET item_name = 'Vinaigrette'                WHERE item_name = 'Vinegrette';
