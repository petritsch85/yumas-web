/* What the payment-fee line can see today. */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: nexi } = await db.from('nexi_statements')
  .select('period_start,period_end,fees_net,debit_date,debit_amount').order('period_start');
console.log('nexi_statements:');
for (const n of nexi ?? []) console.log(' ', n.period_start, '→', n.period_end, '| fees_net', n.fees_net, '| debited', n.debit_date, n.debit_amount);

const { data: docs, error } = await db.from('month_documents')
  .select('kind,month,fees,working_capital,opening_balance,closing_balance')
  .in('kind', ['paypal', 'amex', 'kontoauszug']).order('month');
if (error) console.log('month_documents error:', error.message);
console.log('month_documents:');
for (const d of docs ?? []) console.log(' ', d.month, d.kind, '| fees', d.fees, '| wc', d.working_capital, '| bal', d.opening_balance, '→', d.closing_balance);
