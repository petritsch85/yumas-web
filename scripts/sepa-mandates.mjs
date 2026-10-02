/**
 * Who collects from us by direct debit, and who we pay by hand.
 *
 * The CSV export does not say which it was, but the Kontoauszug does: every
 * booking carries its kind — Lastschrift, Überweisung, Dauerauftrag. Those
 * statements are the ground truth, and they cover three months.
 *
 * For the rest of the year the narrative decides. A transfer entered in online
 * banking carries the portal's own timestamp ("... DATUM 08.09.2026, 13.08
 * UHR"); a collection carries only the creditor's reference. That rule is not
 * assumed here — it is measured against the statements first, and only used
 * where it proved right.
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

const page = async build => { const o = []; for (let p = 0; ; p++) { const { data, error } = await build(p); if (error) throw error; o.push(...data); if (data.length < 500) return o; } };
const eur = n => Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const tx = await page(p => db.from('cashflow_transactions')
  .select('id, date, direction, counterparty, amount_cents, description, category')
  .order('id').range(p * 500, p * 500 + 499));

/* ---- ground truth from the statements ---------------------------------- */
const DIR = 'C:/Users/49172/Downloads';
const statements = fs.readdirSync(DIR).filter(f => /^Konto_0017148925-Auszug_2026_\d+\.PDF$/i.test(f));
const booked = [];
for (const f of statements) {
  const buf = fs.readFileSync(path.join(DIR, f));
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: true });
  const parsed = parseKontoauszug(text);
  if (parsed.balanced === false) { console.log(`!! ${f} does not balance — skipped`); continue; }
  booked.push(...parsed.entries.map(e => ({ ...e, file: f })));
}
console.log(`${statements.length} statement(s), ${booked.length} bookings as ground truth\n`);

/* Match each booking to a ledger row on date and amount, to get the name. */
const byKey = new Map();
for (const t of tx) {
  const signed = (t.direction === 'in' ? 1 : -1) * Math.abs(t.amount_cents);
  const k = `${t.date}|${signed}`;
  byKey.set(k, [...(byKey.get(k) ?? []), t]);
}

const truth = new Map();        // counterparty -> {kind -> count}
let matched = 0;
for (const e of booked) {
  const rows = byKey.get(`${e.date}|${Math.round(e.amount * 100)}`) ?? [];
  if (!rows.length) continue;
  matched++;
  const cp = rows[0].counterparty || '(no counterparty)';
  const m = (truth.get(cp) ?? {});
  m[e.kind] = (m[e.kind] ?? 0) + 1;
  truth.set(cp, m);
  rows[0]._kind = e.kind;
}
console.log(`matched ${matched} of ${booked.length} bookings to ledger rows\n`);

/* ---- test the narrative rule against that truth ------------------------- */
/** A transfer keyed into online banking carries the portal's timestamp. */
const TYPED = /DATUM \d{2}\.\d{2}\.\d{4}, \d{2}\.\d{2} UHR/;
let ok = 0, wrong = 0;
const misses = [];
for (const t of tx.filter(t => t._kind && t.direction !== 'in')) {
  const predicted = TYPED.test(t.description ?? '') ? 'Überweisung' : 'Lastschrift';
  const actual = t._kind;
  if (actual !== 'Lastschrift' && actual !== 'Überweisung') continue;
  if (predicted === actual) ok++; else { wrong++; misses.push({ t, predicted, actual }); }
}
console.log(`narrative rule checked against the statements: ${ok} right, ${wrong} wrong`
  + ` (${(100 * ok / (ok + wrong)).toFixed(1)}%)`);
for (const m of misses.slice(0, 8))
  console.log(`   predicted ${m.predicted}, was ${m.actual}: ${m.t.date} ${m.t.counterparty} — "${(m.t.description ?? '').slice(0, 54)}"`);

/* ---- apply across the whole year --------------------------------------- */
const CARD = /debitk\.|elv\d|kartenzahlung|sagt danke/i;
const agg = new Map();
for (const t of tx) {
  if (t.direction === 'in') continue;
  const cp = t.counterparty || '(no counterparty)';
  const a = agg.get(cp) ?? { cp, debit: 0, debitSum: 0, transfer: 0, transferSum: 0, card: 0, first: t.date, last: t.date, example: '' };
  const v = Math.abs(t.amount_cents) / 100;
  if (CARD.test(t.description ?? '')) a.card++;
  else if (TYPED.test(t.description ?? '')) { a.transfer++; a.transferSum += v; }
  else { a.debit++; a.debitSum += v; if (!a.example) a.example = (t.description ?? '').slice(0, 44); }
  if (t.date < a.first) a.first = t.date;
  if (t.date > a.last) a.last = t.date;
  agg.set(cp, a);
}

/* A mandate shows as repeated collections. One unexplained booking is not a
   mandate, so a counterparty needs at least two before it is listed. */
const mandated = [...agg.values()].filter(a => a.debit >= 2 && a.debitSum > 0)
  .sort((x, y) => y.debitSum - x.debitSum);

console.log(`\n\n=== COUNTERPARTIES THAT COLLECT BY DIRECT DEBIT (${mandated.length})\n`);
console.log('   collections      total €   also transferred   last seen   counterparty');
for (const a of mandated)
  console.log(`   ${String(a.debit).padStart(6)}  ${eur(a.debitSum).padStart(13)}   ${String(a.transfer).padStart(6)} / ${eur(a.transferSum).padStart(11)}   ${a.last}   ${a.cp.slice(0, 44)}`);

const both = mandated.filter(a => a.transfer >= 1);
console.log(`\n--- of those, ${both.length} are ALSO paid by manual transfer sometimes:`);
for (const a of both) console.log(`   ${a.cp.slice(0, 46).padEnd(48)} ${a.debit} collected / ${a.transfer} transferred`);

const transferOnly = [...agg.values()].filter(a => a.debit === 0 && a.transfer >= 2)
  .sort((x, y) => y.transferSum - x.transferSum).slice(0, 25);
console.log(`\n--- paid ONLY by manual transfer (no mandate), top 25 by value:`);
for (const a of transferOnly)
  console.log(`   ${eur(a.transferSum).padStart(13)} €  ${String(a.transfer).padStart(3)}x  ${a.cp.slice(0, 50)}`);
