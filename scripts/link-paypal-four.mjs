/**
 * The four September PayPal purchases whose invoice we already hold.
 *
 * Each is refused by the matcher for a reason that is right in general and
 * wrong here:
 *
 *   Walch, Cyberport — the amount differs by a cent or two, and matching
 *     demands agreement to the cent. One day apart, unique supplier.
 *   KOMTRA ×2 — two invoices of 55,40 and two payments of 55,40, so the
 *     matcher refuses to guess which belongs to which. The dates say it
 *     plainly: 02.09 → 03.09 and 17.09 → 18.09.
 *
 * Written as links rather than bill_id so each carries a note saying why it
 * was made, and so it can be undone from the Cash Flow page like any other.
 *
 *   node scripts/link-paypal-four.mjs          → zeigt nur, was es täte
 *   node scripts/link-paypal-four.mjs --apply  → schreibt
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const apply = process.argv.includes('--apply');

/* Payment identified by date + exact cents; invoice by its number. Both must
   resolve to exactly one row or nothing is written — a script that guesses is
   worse than one that stops. */
const PLAN = [
  { txDate: '2026-09-30', txCents: 67035, invoice: '26109210',
    note: 'PayPal-Einkauf Walch Food · Rechnung 670,37 €, gezahlt 670,35 € — 2 Cent Rundungsdifferenz' },
  { txDate: '2026-09-01', txCents: 22807, invoice: '6007218832',
    note: 'PayPal-Einkauf Cyberport · Rechnung 228,06 €, gezahlt 228,07 € — 1 Cent Rundungsdifferenz' },
  { txDate: '2026-09-03', txCents: 5540, invoice: '26455290',
    note: 'PayPal-Einkauf KOMTRA · Rechnung vom 02.09., Zahlung am 03.09.' },
  { txDate: '2026-09-18', txCents: 5540, invoice: '26457126',
    note: 'PayPal-Einkauf KOMTRA · Rechnung vom 17.09., Zahlung am 18.09.' },
];

let wrote = 0;
for (const p of PLAN) {
  const { data: txs } = await db.from('cashflow_transactions')
    .select('id,date,counterparty,description,amount_cents,bill_id')
    .eq('date', p.txDate).eq('direction', 'out').eq('amount_cents', p.txCents)
    .ilike('counterparty', '%paypal%');
  const { data: bs } = await db.from('bills')
    .select('id,supplier_name,invoice_number,invoice_date,gross_amount')
    .eq('invoice_number', p.invoice);

  const tx = txs?.length === 1 ? txs[0] : null;
  const bill = bs?.length === 1 ? bs[0] : null;
  const head = `${(p.txCents / 100).toFixed(2)} € ${p.txDate} → ${p.invoice}`;

  if (!tx || !bill) {
    console.log(`  ✘ ${head}: ${!tx ? `${txs?.length ?? 0} Zahlungen` : `${bs?.length ?? 0} Rechnungen`} gefunden — übersprungen`);
    continue;
  }
  if (tx.bill_id) { console.log(`  – ${head}: Zahlung ist bereits verknüpft`); continue; }

  const { data: already } = await db.from('transaction_bill_links')
    .select('id').eq('transaction_id', tx.id).eq('bill_id', bill.id);
  if (already?.length) { console.log(`  – ${head}: Verknüpfung besteht schon`); continue; }

  console.log(`  ✔ ${head}  ${bill.supplier_name} · ${bill.invoice_date} · ${Number(bill.gross_amount).toFixed(2)} €`);
  if (!apply) continue;

  const { error } = await db.from('transaction_bill_links')
    .insert({ transaction_id: tx.id, bill_id: bill.id, note: p.note, amount: Math.abs(tx.amount_cents) / 100 });
  if (error) { console.log(`      Fehler: ${error.message}`); continue; }
  await db.from('bills').update({ status: 'paid' }).eq('id', bill.id);
  wrote++;
}

console.log(apply ? `\n${wrote} Verknüpfung(en) geschrieben.` : '\nProbelauf — mit --apply schreiben.');
