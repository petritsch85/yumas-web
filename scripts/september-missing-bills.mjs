/**
 * Payments in the month with no invoice behind them.
 *
 * These are the gaps in the Steuerberater folder: a booking on the statement
 * with nothing to file behind it. Not every one is a missing document — wages,
 * taxes, social security and the loan never had an invoice — so those are
 * named and set aside rather than left in a list nobody can work through.
 *
 * The page and booking number come from the Kontoauszug, so a gap can be found
 * on the printed statement rather than searched for.
 *
 *   node scripts/september-missing-bills.mjs 2026-09
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

const page = async build => { const o = []; for (let p = 0; ; p++) { const { data, error } = await build(p); if (error) throw error; o.push(...data); if (data.length < 1000) return o; } };
const eur = n => Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const month = process.argv[2] ?? '2026-09';
const [y, m] = month.split('-').map(Number);
const from = `${month}-01`;
const to = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;

/**
 * Payments that never have an invoice.
 *
 * Wages, the funds, the Finanzamt and the loan are not documents anybody
 * forgot to upload — they are evidenced by the payroll run, the contribution
 * statements and the loan agreement. Listing them as gaps would bury the few
 * that are real.
 */
const NO_INVOICE_EXPECTED = [
  [/lohn|gehalt|abschlag|vorschuss|finale? zahlung gehalt/i, 'Lohn/Gehalt'],
  [/aok|techniker krankenkasse|barmer|dak|ikk |bkk |hkk |knappschaft|meine krankenkasse|hek -/i, 'Krankenkasse'],
  [/^fa ffm|steuernr|lohnst|ums\.st/i, 'Finanzamt'],
  [/berufsgenossenschaft/i, 'Berufsgenossenschaft'],
  [/darl\.-leistung|zinsr[üu]ckzahlung|gesellschafterdarlehen/i, 'Darlehen/Zinsen'],
  [/abrechnung \d{2}\.\d{2}\.\d{4}|kontof[üu]hrung|entgelte vom/i, 'Bankentgelte'],
  [/bundeskasse|stadtkasse|gemeinschaftskasse|landeswohlfahrt|rundfunk/i, 'Behörden/Gebühren'],
  [/^wohnraum|^strabag|^patricia wohninveste|^laura klein/i, 'Miete (Ersatzbeleg vorhanden)'],
];
const expected = t => {
  const s = `${t.counterparty ?? ''} ${t.description ?? ''}`;
  for (const [re, label] of NO_INVOICE_EXPECTED) if (re.test(s)) return label;
  return null;
};

/* Where each booking sits in the printed statement, if we have it. */
const order = new Map();
try {
  const { data: doc } = await db.from('month_documents')
    .select('file_path,bucket').eq('kind', 'kontoauszug').eq('month', from).maybeSingle();
  let bytes = null;
  if (doc?.file_path) {
    const { data } = await db.storage.from(doc.bucket || 'cashflow-files').download(doc.file_path);
    if (data) bytes = new Uint8Array(await data.arrayBuffer());
  } else {
    /* Not filed yet — fall back to the copy in Downloads so the list is usable now. */
    const local = `C:/Users/49172/Downloads/Konto_0017148925-Auszug_${y}_0036.PDF`;
    if (fs.existsSync(local)) bytes = new Uint8Array(fs.readFileSync(local));
  }
  if (bytes) {
    const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
    parseKontoauszug(text).entries.forEach((e, i) => {
      const k = `${e.date}|${Math.round(e.amount * 100)}`;
      if (!order.has(k)) order.set(k, { seq: i + 1, page: e.page });
    });
  }
} catch { /* no statement: the list still works, just without page numbers */ }

const tx = (await page(p => db.from('cashflow_transactions')
  .select('id,date,direction,counterparty,amount_cents,description,category,bill_id')
  .gte('date', from).lte('date', to).order('id').range(p * 1000, p * 1000 + 999)));
const links = await page(p => db.from('transaction_bill_links')
  .select('transaction_id').order('transaction_id').range(p * 1000, p * 1000 + 999));
const linked = new Set([...links.map(l => String(l.transaction_id)),
  ...tx.filter(t => t.bill_id).map(t => String(t.id))]);

const out = tx.filter(t => t.direction !== 'in' && !linked.has(String(t.id)));
const real = out.filter(t => !expected(t));
const known = out.filter(t => expected(t));

const place = t => order.get(`${t.date}|${-Math.abs(t.amount_cents)}`);
const amount = t => Math.abs(t.amount_cents) / 100;
const sum = rows => rows.reduce((s, t) => s + amount(t), 0);

console.log(`ZAHLUNGEN ${month} OHNE RECHNUNG\n`);
console.log(`${tx.filter(t => t.direction !== 'in').length} Zahlungen im Monat · ${out.length} ohne verknüpfte Rechnung`);
console.log(`davon ${known.length} ohne Rechnung erwartet (Lohn, Kassen, Finanzamt, Darlehen …)`);
console.log(`\n>>> ${real.length} Zahlungen, zu denen eine Rechnung fehlt — ${eur(sum(real))} €\n`);

console.log('Seite/Pos   Datum        Betrag        Empfänger / Verwendungszweck');
console.log('─'.repeat(100));
for (const t of real.sort((a, b) => amount(b) - amount(a))) {
  const p = place(t);
  const where = p ? `S${String(p.page).padStart(2, '0')}/${String(p.seq).padStart(3, '0')}` : '  —   ';
  console.log(`${where}   ${t.date}  ${eur(amount(t)).padStart(10)} €  ${String(t.counterparty ?? '—').slice(0, 44)}`);
  console.log(`                                       ${String(t.description ?? '').slice(0, 76)}`);
}

console.log(`\n\nOHNE RECHNUNG ERWARTET — ${eur(sum(known))} € (nur zur Kontrolle, nichts zu beschaffen)\n`);
const byReason = {};
for (const t of known) (byReason[expected(t)] ??= []).push(t);
for (const [reason, rows] of Object.entries(byReason).sort((a, z) => sum(z[1]) - sum(a[1])))
  console.log(`   ${String(rows.length).padStart(3)}x  ${eur(sum(rows)).padStart(12)} €  ${reason}`);
