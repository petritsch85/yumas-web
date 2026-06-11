-- Add per-item confirmation tracking to store delivery receipts
ALTER TABLE store_delivery_receipts
ADD COLUMN IF NOT EXISTS confirmed_item_ids text[] DEFAULT '{}';
