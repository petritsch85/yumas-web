/**
 * Settles the cash flow against the official Kontoauszug.
 *
 * The CSV exports are a convenience; the statement is the record. Where a CSV
 * carried a payment the bank had not yet booked — a vorgemerkte item — and a
 * later export carried the same payment again under its real booking date, the
 * ledger ends up holding it twice. Twelve of those sat in September alone,
 * 25.975,58 € of money that never left the account.
 *
 * For every amount the ledger holds more often than the bank booked it, the
 * surplus rows go and the survivor takes the bank's own booking date. A row
 * carrying bill links is always the survivor, so no link is broken.
 *
 *   node scripts/reconcile-to-statement.mjs <statement.pdf> --dry
 *   node scripts/reconcile-to-statement.mjs <statement.pdf>
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { extractText, getDocumentProxy } from 'unpdf';
import { parseKontoauszug } from '../lib/kontoauszug.mjs';

const root = path.resolve(import.meta.dirname, '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const file = process.argv.find(a => /\.pdf$/i.test(a));
const dry = process.argv.includes('--dry');
if (!file) { console.error('usage: node scripts/reconcile-to-statement.mjs <statement.pdf> [--dry]'); process.exit(1); }

const { text } = await extractText(await getDocumentProxy(new Uint8Array(fs.readFileSync(file))), { mergePages: true });
const { entries, from, to, number } = parseKontoauszug(text);
const net = entries.reduce((s, e) => s + e.amount, 0);
console.log(`Kontoauszug ${number ?? '?'} · ${from} … ${to} · ${entries.length} bookings · net ${net.toFixed(2)} €${dry ? '  (dry run)' : ''}\n`);

const pageAll = async build => { const o = []; for (let p = 0; ; p++) { const { data, error } = await build(p); if (error) throw error; o.push(...data); if (data.length < 500) return o; } };
const txs = await pageAll(p => db.from('cashflow_transactions')
  .select('id, date, direction, counterparty, description, amount_cents, bill_id')
  .gte('date', from).lte('date', to).order('id').range(p * 500, p * 500 + 499));
const links = await pageAll(p => db.from('transaction_bill_links').select('transaction_id').order('id').range(p * 500, p * 500 + 499));
const linked = new Set([...links.map(l => l.transaction_id), ...txs.filter(t => t.bill_id).map(t => t.id)]);

const signed = t => (t.direction === 'in' ? 1 : -1) * Math.abs(t.amount_cents);
const byAmount = new Map();
for (const t of txs) byAmount.set(signed(t), [...(byAmount.get(signed(t)) ?? []), t]);
const bankBy = new Map();
for (const e of entries) {
  const c = Math.round(e.amount * 100);
  bankBy.set(c, [...(bankBy.get(c) ?? []), e]);
}

const plan = [];
for (const [cents, mine] of byAmount) {
  const bank = bankBy.get(cents) ?? [];
  if (mine.length <= bank.length) continue;
  /* Keep the ones the bank booked, preferring rows that carry bill links. */
  const ranked = [...mine].sort((a, b) =>
    (linked.has(b.id) ? 1 : 0) - (linked.has(a.id) ? 1 : 0)
    || (bank.some(e => e.date === a.date) ? -1 : 1));
  const keep = ranked.slice(0, bank.length);
  const drop = ranked.slice(bank.length);
  keep.forEach((t, i) => { if (bank[i] && t.date !== bank[i].date) plan.push({ kind: 'redate', t, to: bank[i].date }); });
  drop.forEach(t => plan.push({ kind: 'delete', t }));
}

const deletes = plan.filter(p => p.kind === 'delete');
const redates = plan.filter(p => p.kind === 'redate');
console.log(`${deletes.length} row(s) the bank never booked · ${redates.length} date(s) to correct\n`);
for (const p of plan.sort((a, b) => Math.abs(b.t.amount_cents) - Math.abs(a.t.amount_cents))) {
  const v = ((p.t.direction === 'in' ? 1 : -1) * Math.abs(p.t.amount_cents) / 100).toFixed(2);
  console.log(p.kind === 'delete'
    ? `  remove  ${p.t.date}  ${v.padStart(11)}  ${(p.t.counterparty ?? '').slice(0, 34)}`
    : `  redate  ${p.t.date} -> ${p.to}  ${v.padStart(11)}  ${(p.t.counterparty ?? '').slice(0, 34)}${linked.has(p.t.id) ? '  (keeps its bill link)' : ''}`);
}
const removed = deletes.reduce((s, p) => s + (p.t.direction === 'in' ? 1 : -1) * Math.abs(p.t.amount_cents) / 100, 0);
console.log(`\n  removing ${removed.toFixed(2)} € of bookings the bank never made`);

if (dry) { console.log('\n(dry run — nothing written)'); process.exit(0); }
for (const p of redates) {
  const { error } = await db.from('cashflow_transactions').update({ date: p.to }).eq('id', p.t.id);
  if (error) console.error(`  redate failed ${p.t.id}: ${error.message}`);
}
const ids = deletes.map(p => p.t.id);
if (ids.length) {
  const { error } = await db.from('cashflow_transactions').delete().in('id', ids);
  if (error) console.error(`  delete failed: ${error.message}`);
}
console.log(`\ndone — ${redates.length} redated, ${ids.length} removed`);
