-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add new columns to items (no-op if they already exist)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS gross_price      numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS occasion         text          DEFAULT 'L+D'
    CHECK (occasion IN ('L','D','L+D')),
  ADD COLUMN IF NOT EXISTS menu_category    text
    CHECK (menu_category IN ('Starter','Main','Drinks')),
  ADD COLUMN IF NOT EXISTS guest_multiplier integer       DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Delete ALL existing finished goods (dummy data)
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM items WHERE product_type = 'finished';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Insert distinct products from shift_report_products
--    • gross_price  = SUM(gross_sales) / SUM(quantity) — weighted average unit price
--    • menu_category inferred from product name keywords
--    • occasion: alcoholic drinks → D; everything else → L+D
--    • guest_multiplier: Main → 1; Starter/Drinks → 0
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO items (
  name,
  product_type,
  is_active,
  is_purchasable,
  is_produced,
  unit_id,
  gross_price,
  occasion,
  menu_category,
  guest_multiplier
)
WITH product_stats AS (
  -- Weighted average unit price per product across all shifts
  SELECT
    product_name,
    ROUND(SUM(gross_sales) / NULLIF(SUM(quantity), 0), 2) AS avg_price
  FROM shift_report_products
  GROUP BY product_name
),
categorized AS (
  SELECT
    product_name,
    avg_price,

    -- ── Category ──────────────────────────────────────────────────────────────
    CASE
      -- Starters (appetisers, salads, sharing plates)
      WHEN product_name ~* '(pica pica|nachos|guacamole|quesadilla|molletes|ensalada|salad|chips|vorspeise|starter)'
        THEN 'Starter'

      -- Drinks: all beverages (alcoholic + non-alcoholic)
      WHEN product_name ~* '(margarita|cocktail|sour|aperol|spritz|mojito|negroni|gin\b|rum\b|vodka|whisky|whiskey|tequila|mezcal|frozen|sinnerman|ipanema|pisco|hugo)'
        THEN 'Drinks'
      WHEN product_name ~* '(bier|beer|corona\b|kronenhof|modelo|victoria|cerveza|carlsberg|heineken|pale ale|lager|ale\b)'
        THEN 'Drinks'
      WHEN product_name ~* '(wein|wine|grauburgunder|riesling|prosecco|sekt|cava|vino|chardonnay|sauvignon|merlot|pinot)'
        THEN 'Drinks'
      WHEN product_name ~* '(wasser|water|still|sprudel|cola|fanta|sprite|limonade|limo\b|softdrink|juice|saft)'
        THEN 'Drinks'
      WHEN product_name ~* '(agua\b|horchata|jamaica\b|tepache|fresca)'
        THEN 'Drinks'
      WHEN product_name ~* '(café|cafe|kaffee|coffee|latte|cappuccino|espresso|americano\b|flat white|macchiato|tee\b|tea\b)'
        THEN 'Drinks'

      -- Everything else is a Main
      ELSE 'Main'
    END AS menu_category,

    -- ── Occasion ──────────────────────────────────────────────────────────────
    -- Alcoholic drinks are dinner-only; food + non-alcoholic → both
    CASE
      WHEN product_name ~* '(margarita|cocktail|sour|aperol|spritz|mojito|negroni|gin\b|rum\b|vodka|whisky|whiskey|tequila|mezcal|frozen|sinnerman|ipanema|pisco|hugo)'
        THEN 'D'
      WHEN product_name ~* '(bier|beer|corona\b|kronenhof|modelo|victoria|cerveza|carlsberg|heineken|pale ale|lager|ale\b)'
        THEN 'D'
      WHEN product_name ~* '(wein|wine|grauburgunder|riesling|prosecco|sekt|cava|vino|chardonnay|sauvignon|merlot|pinot)'
        THEN 'D'
      ELSE 'L+D'
    END AS occasion

  FROM product_stats
)
SELECT
  c.product_name,
  'finished'::text,
  true,
  false,
  true,
  (SELECT id FROM units_of_measure WHERE abbreviation = 'por' LIMIT 1),
  c.avg_price,
  c.occasion,
  c.menu_category,
  CASE WHEN c.menu_category = 'Main' THEN 1 ELSE 0 END
FROM categorized c
ORDER BY c.menu_category, c.product_name;

-- ─────────────────────────────────────────────────────────────────────────────
-- Done — verify with:
-- SELECT name, gross_price, occasion, menu_category, guest_multiplier
-- FROM items WHERE product_type = 'finished' ORDER BY menu_category, name;
-- ─────────────────────────────────────────────────────────────────────────────
