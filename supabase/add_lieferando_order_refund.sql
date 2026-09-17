-- Refunds (Rückbuchungen) appear on the Lieferando statement as a negative
-- line under the order's own number. Kept on the order rather than as a row
-- of its own.
alter table public.lieferando_orders
  add column if not exists refund numeric(12,2) not null default 0;
