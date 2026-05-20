-- Per-store sort order for inventory items
-- store_sort_orders: {"Eschborn": 10, "Taunus": 20, "Westend": 30}
-- Falls back to global sort_order if a store has no entry yet.

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS store_sort_orders JSONB NOT NULL DEFAULT '{}';

-- Backfill: copy global sort_order into every store slot for all existing items
UPDATE inventory_items
SET store_sort_orders = jsonb_build_object(
  'Eschborn', sort_order,
  'Taunus',   sort_order,
  'Westend',  sort_order
);

-- ── RPC helpers ──────────────────────────────────────────────────────────────

-- Set sort order for ONE store without touching other stores' values
CREATE OR REPLACE FUNCTION set_item_store_sort_order(
  p_item_id       UUID,
  p_location_name TEXT,
  p_sort_order    INTEGER
) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE inventory_items
  SET    store_sort_orders = store_sort_orders || jsonb_build_object(p_location_name, p_sort_order)
  WHERE  id = p_item_id;
$$;

-- Remove item from ONE store (leaves it visible in other stores)
CREATE OR REPLACE FUNCTION remove_item_from_store(
  p_item_id       UUID,
  p_location_name TEXT
) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE inventory_items
  SET    stores = array_remove(stores, p_location_name)
  WHERE  id = p_item_id;
$$;
