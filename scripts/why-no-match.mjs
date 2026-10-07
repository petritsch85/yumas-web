/* Why a given September payment does not match the bill we just imported. */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const WANT = [2249, 360, 15000, 220507, 4800];   // cents

const page = async build => { const o = []; for (let p = 0; ; p++) { const { data, error } = await build(p); if (error) throw error; o.push(...data); if (data.length < 1000) return o; } };

const tx = await page(p => db.from('cashflow_transactions')
  .select('id,date,counterparty,description,amount_cents,direction,bill_id')
  .gte('date', '2026-09-01').lte('date', '2026-09-30')
  .range(p * 1000, p * 1000 + 999));

const bills = await page(p => db.from('bills')
  .select('id,supplier_name,invoice_number,invoice_date,gross_amount,status,created_at')
  .range(p * 1000, p * 1000 + 999));

const linked = new Set();
for (const t of tx) if (t.bill_id) linked.add(t.bill_id);
const links = await page(p => db.from('transaction_bill_links').select('transaction_id,bill_id').range(p * 1000, p * 1000 + 999));
for (const l of links) linked.add(l.bill_id);

const days = (a, b) => Math.round(Math.abs(new Date(a) - new Date(b)) / 86400000);
const sameSupplier = (t, b) => {
  const txLower = (t.counterparty ?? '').toLowerCase();
  return (b.supplier_name ?? '').toLowerCase().split(' ')
    .some(w => w.length > 3 && txLower.includes(w));
};

for (const want of WANT) {
  const t = tx.find(x => Math.abs(x.amount_cents) === want && x.direction === 'out' && !x.bill_id);
  if (!t) { console.log(`\n${(want / 100).toFixed(2)} € — keine offene Zahlung gefunden`); continue; }
  console.log(`\n── ${(want / 100).toFixed(2)} €  ${t.date}  ${t.counterparty}`);
  console.log(`   Verwendungszweck: ${String(t.description ?? '').slice(0, 90)}`);

  const cands = bills.filter(b => Math.round(Math.abs(Number(b.gross_amount)) * 100) === want);
  if (!cands.length) { console.log('   → keine Rechnung mit diesem Betrag im System'); continue; }
  for (const b of cands) {
    const d = b.invoice_date ? days(b.invoice_date, t.date) : null;
    console.log(`   Kandidat: ${b.supplier_name} · ${b.invoice_date} · ${b.invoice_number} · ${b.status}`);
    console.log(`      schon verknüpft: ${linked.has(b.id) ? 'JA' : 'nein'}`);
    console.log(`      sameSupplier(counterparty): ${sameSupplier(t, b) ? 'JA' : 'NEIN'}`);
    console.log(`      Name im Verwendungszweck:   ${(b.supplier_name ?? '').toLowerCase().split(' ').some(w => w.length > 3 && String(t.description ?? '').toLowerCase().includes(w)) ? 'JA' : 'nein'}`);
    console.log(`      Tage Abstand: ${d ?? '—'} ${d !== null && d > 45 ? '  ← über 45, fällt raus' : ''}`);
  }
}
