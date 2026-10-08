/**
 * gastromatic is a software tool, all of it.
 *
 * It bills twice a month — a flat 707,20 € subscription at month end and a
 * variable charge mid-month that moves with headcount — and the two were being
 * filed apart: the variable one as Labour from February to July, as Software &
 * Technology in September. Six of one, one of the other, and the September odd
 * one out is what made it visible.
 *
 * Decided as software throughout, so the six Labour ones move. It is a tool the
 * business licenses, not what the staff cost; the per-head element is how the
 * licence is priced, not a wage.
 *
 *   node scripts/recategorise-gastromatic.mjs           → zeigt nur
 *   node scripts/recategorise-gastromatic.mjs --apply   → schreibt
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const apply = process.argv.includes('--apply');

const TO = 'Software & Technology';

const { data: bills, error } = await db.from('bills')
  .select('id,supplier_name,category,invoice_number,invoice_date,net_amount')
  .or('supplier_name.ilike.%vertical cloud%,supplier_name.ilike.%gastromatic%')
  .order('invoice_date');
if (error) { console.error(error.message); process.exit(1); }

const move = (bills ?? []).filter(b => b.category !== TO);
console.log(`${bills.length} gastromatic-Rechnungen · ${move.length} umzubuchen auf "${TO}"\n`);

let done = 0;
for (const b of move) {
  console.log(`  ${b.invoice_date}  ${Number(b.net_amount).toFixed(2).padStart(9)} €  ${b.invoice_number}  ${b.category} → ${TO}`);
  if (!apply) continue;
  const { error: e } = await db.from('bills').update({ category: TO }).eq('id', b.id);
  if (e) console.log(`     FEHLER: ${e.message}`); else done++;
}
console.log(`\nSumme: ${move.reduce((t, b) => t + Number(b.net_amount ?? 0), 0).toFixed(2)} €`);
console.log(apply ? `${done} umgebucht.` : 'Probelauf — mit --apply schreiben.');
