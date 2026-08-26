-- Category for purchased goods, used to group the Items page into
-- Meat / Fruit & Veg / Other tables.
--
-- Values mirror the COGS sub-categories: 'Meat', 'Fruit & Veg', 'Spices',
-- 'Dairy', 'Leergut', 'Other'. Left as free text rather than an enum so the
-- list can be extended without a migration.
ALTER TABLE purchased_goods
  ADD COLUMN IF NOT EXISTS category text;

COMMENT ON COLUMN purchased_goods.category IS
  'Grouping for the Items page. NULL is treated as "Other".';
