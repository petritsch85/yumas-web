/**
 * Undo the contract Ersatzbelege.
 *
 * A run of create-contract-bills.mjs was interrupted, but not before it had
 * written 55 substitute bills for Süwag, schwarzwald energy and abcfinance and
 * linked each to its Lastschrift. They were not wanted, and half a set is worse
 * than none: three suppliers would carry substitutes and five would not.
 *
 * The payments are released first and the bills deleted second. A bill still
 * attached to a transaction must never be deleted — the link would be left
 * pointing at nothing — so the order matters, and the delete is restricted to
 * the exact ids whose links came off.
 *
 * Identified by the marker the generator wrote into notes, not by supplier: a
 * real Süwag invoice arriving by email must not be swept up with these. Every
 * one of them also has no file behind it, which is checked.
 *
 *   node scripts/remove-contract-ersatzbelege.mjs           → zeigt nur
 *   node scripts/remove-contract-ersatzbelege.mjs --apply   → löscht
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const apply = process.argv.includes('--apply');
const page = async b => { const o = []; for (let p = 0; ; p++) { const { data, error } = await b(p); if (error) throw error; o.push(...data); if (data.length < 1000) return o; } };

const MARKER = '%aus der Lastschrift erzeugt%';

const bills = await page(p => db.from('bills')
  .select('id,supplier_name,invoice_number,invoice_date,category,net_amount,file_path,notes')
  .ilike('notes', MARKER).range(p * 1000, p * 1000 + 999));

/* A substitute has no document. Anything here that does is not one of ours and
   is left alone rather than deleted on the strength of a note. */
const withFile = bills.filter(b => b.file_path);
const targets = bills.filter(b => !b.file_path);

const by = new Map();
for (const b of targets) {
  const c = by.get(b.supplier_name) ?? { n: 0, net: 0 };
  c.n++; c.net += Number(b.net_amount ?? 0);
  by.set(b.supplier_name, c);
}
console.log(`${bills.length} Ersatzbelege gefunden · ${targets.length} zu löschen\n`);
for (const [k, c] of [...by.entries()].sort((a, z) => z[1].net - a[1].net)) {
  console.log(`  ${String(c.n).padStart(3)}x  ${c.net.toFixed(2).padStart(10)} €  ${k}`);
}
if (withFile.length) {
  console.log(`\n  ${withFile.length} mit hinterlegter Datei — NICHT angefasst:`);
  for (const b of withFile) console.log(`     ${b.supplier_name} · ${b.invoice_number}`);
}

const ids = new Set(targets.map(b => b.id));
const tx = await page(p => db.from('cashflow_transactions')
  .select('id,bill_id').not('bill_id', 'is', null).range(p * 1000, p * 1000 + 999));
const toUnlink = tx.filter(t => ids.has(t.bill_id)).map(t => t.id);
const linkRows = await page(p => db.from('transaction_bill_links')
  .select('id,bill_id').range(p * 1000, p * 1000 + 999));
const toDrop = linkRows.filter(l => ids.has(l.bill_id)).map(l => l.id);

console.log(`\nZahlungen freizugeben: ${toUnlink.length} (bill_id) + ${toDrop.length} (Verknüpfungstabelle)`);
if (!apply) { console.log('\nProbelauf — mit --apply löschen.'); process.exit(0); }

/* Release first, delete second. */
for (let i = 0; i < toUnlink.length; i += 100) {
  const { error } = await db.from('cashflow_transactions')
    .update({ bill_id: null }).in('id', toUnlink.slice(i, i + 100));
  if (error) { console.error(`Freigeben fehlgeschlagen: ${error.message}`); process.exit(1); }
}
for (let i = 0; i < toDrop.length; i += 100) {
  const { error } = await db.from('transaction_bill_links').delete().in('id', toDrop.slice(i, i + 100));
  if (error) { console.error(`Verknüpfungen fehlgeschlagen: ${error.message}`); process.exit(1); }
}

const list = [...ids];
let gone = 0;
for (let i = 0; i < list.length; i += 100) {
  const chunk = list.slice(i, i + 100);
  const { error } = await db.from('bills').delete().in('id', chunk);
  if (error) { console.error(`Löschen fehlgeschlagen: ${error.message}`); process.exit(1); }
  gone += chunk.length;
}

const { data: left } = await db.from('bills').select('id').ilike('notes', MARKER);
console.log(`\n${toUnlink.length} Zahlungen freigegeben, ${gone} Ersatzbelege gelöscht.`);
console.log(`Verbleibend mit diesem Vermerk: ${left?.length ?? 0}`);
