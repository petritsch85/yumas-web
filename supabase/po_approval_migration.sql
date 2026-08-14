-- Allow purchase_order_lines to be created without a supplier_products reference
-- (we source items from supplier_items instead)
ALTER TABLE purchase_order_lines ALTER COLUMN supplier_product_id DROP NOT NULL;

-- Track who approved a PO and when
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS approved_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at   timestamptz;
