/**
 * What is actually on a PayPal Monatsübersicht.
 *
 * PayPal is a second account running beside the bank one, and the statement
 * mixes four unrelated things: delivery customers paying, purchases we make,
 * the Working Capital loan repaying itself out of every sale, and transfers
 * between PayPal and the bank. Each wants different treatment, so the first
 * job is to see how much of each there is.
 *
 *   node scripts/paypal-statement-probe.mjs "C:/path/to/PayPal Sep26.PDF"
 */
import fs from 'fs';
import { extractText, getDocumentProxy } from 'unpdf';

const file = process.argv[2] ?? 'C:/Users/49172/Downloads/PayPal Sep26.PDF';
const { text } = await extractText(
  await getDocumentProxy(new Uint8Array(fs.readFileSync(file))), { mergePages: true });

const de = s => Number(String(s).replace(/\./g, '').replace(',', '.'));
const eur = n => Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Each row ends in a transaction code and three figures: gross, fee, net. The
   wrapping in between is unreliable, so the code is the anchor and everything
   since the previous one is the description. */
const ROW = /([A-Z0-9]{16,20})\s+(-?[\d.]*\d,\d{2})\s+(-?[\d.]*\d,\d{2})\s+(-?[\d.]*\d,\d{2})/g;
/* Page furniture repeats and would otherwise land in a description. */
const NOISE = /Hinweis: Dieser Kontoauszug[\s\S]*?Seite \d+ von\d+|Transaktionsübersicht - EUR|Datum Typ Name E-Mail-Adresse Transaktionscode Brutto Entgelt Netto/g;

const flat = text.replace(NOISE, ' ');
const rows = [];
let last = 0, m;
while ((m = ROW.exec(flat)) !== null) {
  const before = flat.slice(last, m.index).replace(/\s+/g, ' ').trim();
  last = ROW.lastIndex;
  const date = (before.match(/(\d{2}\.\d{2}\.\d{2})/) ?? [])[1] ?? null;
  rows.push({
    date, code: m[1], gross: de(m[2]), fee: de(m[3]), net: de(m[4]),
    desc: before.replace(/^\d{2}\.\d{2}\.\d{2}\s*/, ''),
  });
}

/** Which of the four things a row is. */
function kind(r) {
  const d = r.desc;
  /* The address wraps mid-word in the PDF — "de-ppwc-" then "repayment@paypal."
     on the next line — so the hyphen may carry a space after it. */
  if (/ppwc-\s*repayment|Working Capital/i.test(d)) return 'Working-Capital-Tilgung';
  if (/Bankgutschrift auf PayPal/i.test(d))         return 'Aufladung vom Bankkonto';
  if (/Allgemeine Abbuchung\s*[–-]\s*Bankkonto|Abbuchung vom PayPal/i.test(d)) return 'Auszahlung aufs Bankkonto';
  if (/Allgemeines Entgelt|Zahlungsgebühr/i.test(d)) return 'Gebühr';
  if (r.gross > 0) return 'Kundenzahlung (Eingang)';
  return 'Einkauf (Ausgang)';
}

const by = {};
for (const r of rows) {
  const k = kind(r);
  (by[k] ??= { n: 0, gross: 0, fee: 0, net: 0, rows: [] });
  by[k].n++; by[k].gross += r.gross; by[k].fee += r.fee; by[k].net += r.net;
  by[k].rows.push(r);
}

console.log(`${rows.length} Buchungen gelesen\n`);
console.log('Art                           Anzahl        Brutto      Entgelt         Netto');
for (const [k, v] of Object.entries(by).sort((a, z) => Math.abs(z[1].net) - Math.abs(a[1].net)))
  console.log(`${k.padEnd(28)} ${String(v.n).padStart(5)}  ${eur(v.gross).padStart(12)} ${eur(v.fee).padStart(12)} ${eur(v.net).padStart(13)}`);
console.log(`${'SUMME'.padEnd(28)} ${String(rows.length).padStart(5)}  ${eur(rows.reduce((s, r) => s + r.gross, 0)).padStart(12)} `
  + `${eur(rows.reduce((s, r) => s + r.fee, 0)).padStart(12)} ${eur(rows.reduce((s, r) => s + r.net, 0)).padStart(13)}`);

/* The purchases are the ones that need a document behind them. */
const buys = (by['Einkauf (Ausgang)']?.rows ?? []).sort((a, z) => a.net - z.net);
console.log(`\n\nEINKÄUFE — ${buys.length} Stück, ${eur(buys.reduce((s, r) => s + r.net, 0))} €\n`);
const merchant = r => (r.desc.match(/(?:Zahlung|Zahlungsrechnung)\s+(.+?)\s+[\w.-]+@/) ?? [, r.desc.slice(0, 44)])[1];
const byMerchant = {};
for (const r of buys) { const n = merchant(r).slice(0, 40); (byMerchant[n] ??= { n: 0, v: 0 }); byMerchant[n].n++; byMerchant[n].v += r.net; }
for (const [n, v] of Object.entries(byMerchant).sort((a, z) => a[1].v - z[1].v))
  console.log(`   ${String(v.n).padStart(2)}x ${eur(v.v).padStart(10)} €  ${n}`);

const wc = by['Working-Capital-Tilgung'];
if (wc) {
  console.log(`\n\nWORKING CAPITAL — ${wc.n} Tilgungen, ${eur(wc.net)} €`);
  console.log(`   kleinste ${eur(Math.max(...wc.rows.map(r => r.net)))} · größte ${eur(Math.min(...wc.rows.map(r => r.net)))}`);
  const sales = by['Kundenzahlung (Eingang)'];
  if (sales) console.log(`   das sind ${(Math.abs(wc.net) / sales.gross * 100).toFixed(1)}% der Kundenzahlungen (${eur(sales.gross)} €)`);
}
