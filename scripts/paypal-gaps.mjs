/* The PayPal purchases still without an invoice — is the document really absent,
   or do we hold it and the link simply has not been made? */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const page = async b => { const o = []; for (let p = 0; ; p++) { const { data, error } = await b(p); if (error) throw error; o.push(...data); if (data.length < 1000) return o; } };

const tx = await page(p => db.from('cashflow_transactions')
  .select('id,date,counterparty,description,amount_cents,bill_id')
  .gte('date', '2026-09-01').lte('date', '2026-09-30').eq('direction', 'out')
  .ilike('counterparty', '%paypal%').range(p * 1000, p * 1000 + 999));

const bills = await page(p => db.from('bills')
  .select('id,supplier_name,invoice_number,invoice_date,gross_amount,status')
  .range(p * 1000, p * 1000 + 999));

const skipped = await page(p => db.from('inbound_skipped')
  .select('supplier_name,file_name,document_type,gross_amount')
  .range(p * 1000, p * 1000 + 999));

const links = await page(p => db.from('transaction_bill_links').select('transaction_id,bill_id').range(p * 1000, p * 1000 + 999));
const linkedTx = new Set(links.map(l => l.transaction_id));

const merchant = d => (String(d ?? '').match(/ihr\s+einkauf\s+bei\s+(.+)$/i)?.[1] ?? '').trim();
const key = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const words = s => String(s ?? '').toLowerCase().split(/[^a-zà-ÿ0-9]+/).filter(w => w.length > 3
  && !['gmbh', 'mbh', 'co', 'kg', 'ohg', 'limited', 'ltd', 'deutschland'].includes(w));

const open = tx.filter(t => !t.bill_id && !linkedTx.has(t.id));
console.log(`${open.length} PayPal-Zahlungen im September ohne Rechnung\n`);

let haveDoc = 0;
for (const t of open.sort((a, z) => z.amount_cents - a.amount_cents)) {
  const name = merchant(t.description);
  const w = words(name);
  console.log(`${(t.amount_cents / 100).toFixed(2).padStart(9)} €  ${t.date}  ${name}`);

  const sameAmount = bills.filter(b => Math.round(Math.abs(Number(b.gross_amount)) * 100) === Math.abs(t.amount_cents));
  const sameName = bills.filter(b => w.some(x => key(b.supplier_name).includes(key(x))));
  const both = sameName.filter(b => sameAmount.includes(b));

  if (both.length) {
    haveDoc++;
    for (const b of both) console.log(`      ✔ RECHNUNG DA: ${b.supplier_name} · ${b.invoice_date} · ${b.invoice_number} · ${Number(b.gross_amount).toFixed(2)} € · ${b.status}`);
  } else if (sameName.length) {
    console.log(`      ~ ${sameName.length} Rechnung(en) von diesem Händler, aber kein passender Betrag:`);
    for (const b of sameName.slice(0, 3)) console.log(`          ${b.invoice_date} · ${Number(b.gross_amount).toFixed(2)} € · ${b.invoice_number}`);
  } else {
    const aside = skipped.filter(s => w.some(x => key(s.supplier_name).includes(key(x))));
    console.log(aside.length
      ? `      ✘ keine Rechnung — aber ${aside.length} aussortierte(s) Dokument(e): ${aside.slice(0, 3).map(s => `${s.document_type}/${s.file_name}`.slice(0, 48)).join(', ')}`
      : '      ✘ nichts von diesem Händler im System');
  }
}
console.log(`\n${haveDoc} von ${open.length} haben die Rechnung bereits im System.`);
