/**
 * Tie one payment to one invoice, where the matcher cannot and a person can.
 *
 * The cases that need this are the ones where the bank and the invoice name
 * different parties and no rule could bridge them: a marketplace payment names
 * "Kaufland-Marktplatz" while the invoice is headed "KK Verpackungen", the
 * seller behind the stall. The amount and the dates say it is the same
 * purchase; nothing in the text does.
 *
 * It refuses unless the payment and the invoice each resolve to exactly one
 * row — a script that guesses is worse than one that stops — and records why
 * the link was made, so the Cash Flow page can show it and undo it.
 *
 *   node scripts/link-payment.mjs 2026-09-21 21.89 <Rechnungsnummer> "Begründung"
 *   node scripts/link-payment.mjs ... --apply
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const args = process.argv.slice(2).filter(a => a !== '--apply');
const apply = process.argv.includes('--apply');
const [date, amount, invoice, ...rest] = args;
if (!date || !amount || !invoice) {
  console.log('node scripts/link-payment.mjs <YYYY-MM-DD> <Betrag> <Rechnungsnummer> ["Begründung"] [--apply]');
  process.exit(1);
}
const cents = Math.round(Number(String(amount).replace(',', '.')) * 100);
const note = rest.join(' ') || 'Von Hand zugeordnet';

const { data: txs } = await db.from('cashflow_transactions')
  .select('id,date,counterparty,description,amount_cents,bill_id')
  .eq('date', date).eq('direction', 'out').eq('amount_cents', cents);
const { data: bs } = await db.from('bills')
  .select('id,supplier_name,invoice_number,invoice_date,gross_amount,status')
  .eq('invoice_number', invoice);

if (txs?.length !== 1) {
  console.log(`✘ ${txs?.length ?? 0} Zahlungen am ${date} über ${(cents / 100).toFixed(2)} € — eindeutig muss es sein.`);
  for (const t of txs ?? []) console.log(`   ${t.counterparty} · ${String(t.description ?? '').slice(0, 70)}`);
  process.exit(1);
}
if (bs?.length !== 1) {
  console.log(`✘ ${bs?.length ?? 0} Rechnungen mit der Nummer ${invoice}.`);
  process.exit(1);
}
const tx = txs[0], bill = bs[0];

console.log(`Zahlung:  ${tx.date} · ${(tx.amount_cents / 100).toFixed(2)} € · ${tx.counterparty}`);
console.log(`          ${String(tx.description ?? '').slice(0, 90)}`);
console.log(`Rechnung: ${bill.invoice_date} · ${Number(bill.gross_amount).toFixed(2)} € · ${bill.supplier_name} · ${bill.invoice_number}`);
console.log(`Notiz:    ${note}`);

if (tx.bill_id) { console.log('\n– Zahlung ist bereits verknüpft.'); process.exit(0); }
const { data: already } = await db.from('transaction_bill_links')
  .select('id').eq('transaction_id', tx.id).eq('bill_id', bill.id);
if (already?.length) { console.log('\n– Verknüpfung besteht schon.'); process.exit(0); }

if (!apply) { console.log('\nProbelauf — mit --apply schreiben.'); process.exit(0); }

const { error } = await db.from('transaction_bill_links')
  .insert({ transaction_id: tx.id, bill_id: bill.id, note, amount: Math.abs(tx.amount_cents) / 100 });
if (error) { console.log(`\n✘ ${error.message}`); process.exit(1); }
await db.from('bills').update({ status: 'paid' }).eq('id', bill.id);
console.log('\n✔ Verknüpft.');
