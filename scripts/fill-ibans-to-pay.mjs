/**
 * Read the IBAN off the invoices we are about to pay.
 *
 * Only those: a bill marked to_be_paid and not collected by the supplier. An
 * IBAN from an invoice settled two years ago is worth nothing — banks change,
 * suppliers move, and the only one that can be paid into is the one on the
 * invoice in front of us. So this reads the current payment run and stops.
 *
 * No model. An IBAN is a fixed shape with a mod-97 checksum, so a regular
 * expression plus arithmetic finds it exactly or not at all; a checksum cannot
 * hallucinate and a large model can.
 *
 * Where an invoice prints two accounts nothing is written. Guessing which one
 * a supplier wants is precisely the judgement a person should make once, and
 * the dialog already lets them type it and remembers it against the
 * counterparty.
 *
 *   node scripts/fill-ibans-to-pay.mjs           → zeigt nur
 *   node scripts/fill-ibans-to-pay.mjs --apply   → schreibt
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { extractText, getDocumentProxy } from 'unpdf';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const apply = process.argv.includes('--apply');

/** Our own account. It appears as the account being debited, never as a payee. */
const OURS = 'DE98560501800017148925';

const normalise = s => String(s ?? '').replace(/\s+/g, '').toUpperCase();

function validIban(raw) {
  const i = normalise(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(i)) return false;
  const re = i.slice(4) + i.slice(0, 4);
  const digits = re.replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const d of digits) rem = (rem * 10 + Number(d)) % 97;
  return rem === 1;
}

/**
 * How long an IBAN is, by country. This is the whole trick.
 *
 * A pattern that simply matches "letters, digits and spaces" cannot tell where
 * an IBAN ends, and greedily swallows whatever follows: "IBAN: LT06 3250 0390
 * 1028 4321 BIC" took the BIC with it and then failed its checksum, so a
 * perfectly legible account was reported as missing. Lengths are fixed per
 * country, so the right number of characters is taken and nothing else.
 */
const IBAN_LENGTH = {
  AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20,
  ES: 24, FI: 18, FR: 27, GB: 22, GR: 27, HR: 21, HU: 28, IE: 22, IT: 27,
  LI: 21, LT: 20, LU: 20, LV: 21, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25,
  RO: 24, SE: 24, SI: 19, SK: 24,
};

/**
 * Every valid IBAN in a piece of text.
 *
 * Tried from EVERY position a country code appears, not once per regex match,
 * because a single pass lets a bad early match eat a good later one: on
 * "USTID DE212657916 IBAN DE11 8504 …" the VAT number matched first, consumed
 * the rest of the line, failed its checksum, and the real account — four words
 * further on — was never looked at.
 *
 * From each start the next characters are gathered, spaces skipped, until the
 * country's own length is reached. Then mod-97 decides. Wrong starts cost two
 * dozen character comparisons and are thrown out by the checksum.
 */
function findIbans(text) {
  const s = String(text ?? '').toUpperCase();
  const out = new Set();

  for (let i = 0; i < s.length - 4; i++) {
    if (!/[A-Z]/.test(s[i]) || !/[A-Z]/.test(s[i + 1])) continue;
    /* A country code is a word of its own or starts one: without this every
       pair of letters inside a word is a starting point. */
    if (i > 0 && /[A-Z0-9]/.test(s[i - 1])) continue;

    const len = IBAN_LENGTH[s.slice(i, i + 2)];
    if (!len) continue;

    let got = '';
    for (let j = i; j < s.length && got.length < len; j++) {
      const c = s[j];
      if (/[A-Z0-9]/.test(c)) got += c;
      else if (c === ' ' || c === ' ') continue;   // printed in groups
      else break;                                        // punctuation ends it
    }
    if (got.length === len && validIban(got)) out.add(got);
  }
  return [...out];
}

/* A supplier that collects takes the money itself. Copied verbatim from
   AUTO_COLLECTED in lib/payment-terms.ts rather than written afresh: a second,
   broader opinion here filtered out sixteen bills the payment dialog shows,
   which would have left exactly those still asking for an IBAN by hand. */
const COLLECTED = /lastschrift|einzug|direct\s*debit|sepa[- ]?(?:dd|lastschrift|einzug|direct)|paypal|kreditkarte|credit\s*card|mastercard|visa|amex|girocard|ec-?karte/i;

const { data: bills, error } = await db.from('bills')
  .select('id,supplier_name,invoice_number,invoice_date,gross_amount,payment_method,file_path,creditor_iban')
  .eq('status', 'to_be_paid').gt('gross_amount', 0)
  .order('invoice_date');
if (error) { console.error(error.message); process.exit(1); }

const wanted = (bills ?? []).filter(b => !COLLECTED.test(String(b.payment_method ?? '')));
console.log(`${bills.length} Rechnungen "to_be_paid" · ${wanted.length} davon per Überweisung zu zahlen\n`);

let wrote = 0, already = 0, ambiguous = 0, missing = 0, noFile = 0;
const needsHand = [];

for (const b of wanted) {
  const label = `${String(b.supplier_name ?? '—').slice(0, 34).padEnd(34)} ${String(b.invoice_number ?? '').slice(0, 14).padEnd(14)}`;

  if (b.creditor_iban) { already++; console.log(`  ·    ${label} ${b.creditor_iban}  (schon hinterlegt)`); continue; }
  if (!b.file_path) { noFile++; needsHand.push({ b, why: 'kein PDF' }); console.log(`  ✘    ${label} kein PDF`); continue; }

  let hits = [];
  try {
    const { data: file } = await db.storage.from('bills').download(b.file_path);
    if (!file) throw new Error('Datei nicht lesbar');
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: true });
    const t = String(text ?? '');
    if (t.length < 50) {
      needsHand.push({ b, why: 'Scan ohne Textebene' });
      console.log(`  ✘    ${label} Scan ohne Textebene`);
      noFile++; continue;
    }
    hits = findIbans(t).filter(i => i !== OURS);
  } catch (e) {
    needsHand.push({ b, why: String(e.message).slice(0, 40) });
    console.log(`  ✘    ${label} ${String(e.message).slice(0, 40)}`);
    noFile++; continue;
  }

  if (hits.length === 1) {
    console.log(`  ✔    ${label} ${hits[0]}`);
    if (apply) {
      const { error: e } = await db.from('bills').update({ creditor_iban: hits[0] }).eq('id', b.id);
      if (e) console.log(`         FEHLER: ${e.message}`); else wrote++;
    } else wrote++;
  } else if (hits.length > 1) {
    ambiguous++;
    needsHand.push({ b, why: `zwei Konten: ${hits.join(' / ')}` });
    console.log(`  ?    ${label} ${hits.length} Konten — nichts geschrieben: ${hits.join(' / ')}`);
  } else {
    missing++;
    needsHand.push({ b, why: `keine IBAN auf der Rechnung (${b.payment_method ?? '—'})` });
    console.log(`  —    ${label} keine IBAN gedruckt`);
  }
}

console.log(`\n${wrote} IBAN(s) ${apply ? 'geschrieben' : 'gefunden'} · ${already} schon vorhanden`
  + ` · ${ambiguous} mehrdeutig · ${missing} ohne IBAN · ${noFile} nicht lesbar`);

if (needsHand.length) {
  console.log(`\nVon Hand einzutragen (${needsHand.length}):`);
  for (const { b, why } of needsHand) {
    console.log(`   ${String(b.supplier_name ?? '—').slice(0, 34).padEnd(34)} ${Number(b.gross_amount).toFixed(2).padStart(9)} €  ${why}`);
  }
}
if (!apply) console.log('\nProbelauf — mit --apply schreiben.');
