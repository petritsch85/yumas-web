-- ─────────────────────────────────────────────────────────────────────────────
-- Update gross_price on finished goods using weighted average from shift data
-- Formula: SUM(gross_sales) / SUM(quantity) across all shifts
-- Only updates items where a matching product name exists in shift_report_products
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE items i
SET gross_price = p.avg_price
FROM (
  SELECT
    product_name,
    ROUND(SUM(gross_sales) / NULLIF(SUM(quantity), 0), 2) AS avg_price
  FROM shift_report_products
  GROUP BY product_name
) p
WHERE i.name = p.product_name
  AND i.product_type = 'finished';

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify — shows updated prices alongside the shift-derived average
-- SELECT i.name, i.gross_price, i.menu_category
-- FROM items i
-- WHERE i.product_type = 'finished'
-- ORDER BY i.menu_category, i.name;
-- ─────────────────────────────────────────────────────────────────────────────
