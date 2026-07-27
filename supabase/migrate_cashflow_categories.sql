-- Rename outgoing categories to "C - ..." prefix
UPDATE cashflow_transactions
SET category = 'C - ' || category
WHERE direction = 'out'
  AND category NOT LIKE 'C - %';

-- Set incoming categories from sales_type using "S - ..." prefix
UPDATE cashflow_transactions
SET category = CASE
  WHEN sales_type = 'In-House' THEN 'S - In House'
  WHEN sales_type = 'Delivery' THEN 'S - Delivery'
  ELSE 'S - Other'
END
WHERE direction = 'in';
