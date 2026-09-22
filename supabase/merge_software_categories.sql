-- OpenTable and Orderbird are software subscriptions like any other, so the
-- two categories of their own were folded into C - Software.
update public.cashflow_transactions
   set category = 'C - Software'
 where category in ('C - OpenTable', 'C - Orderbird');

update public.counterparties
   set category = 'C - Software'
 where category in ('C - OpenTable', 'C - Orderbird');
