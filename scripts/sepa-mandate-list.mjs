/**
 * The counterparties holding a SEPA direct debit mandate against our account.
 *
 * Three kinds of evidence, strongest first:
 *
 *   1. The narrative carries a Gläubiger-ID (DE..ZZZ...........) and usually a
 *      mandate reference. Only a direct debit has one, so this settles it.
 *   2. The Kontoauszug labelled the booking "Lastschrift". The bank's own word.
 *   3. The narrative carries no online-banking timestamp. A transfer keyed in
 *      by hand always does ("... DATUM 08.09.2026, 13.08 UHR"); a collection
 *      carries the creditor's reference instead. Measured at 228/228 against
 *      the statement before being relied on.
 *
 * Counterparty names arrive in several spellings — trailing spaces, upper and
 * lower case, "GmbH" against "GMBH" — so they are folded before counting, or
 * METRO and PayPal each appear twice.
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

/** The SEPA Creditor Identifier: country, check digits, business code, 11 more. */
const GLAEUBIGER = /\b([A-Z]{2}\d{2}[A-Z0-9]{3}\d{11})\b/;
/** A transfer entered in online banking; a collection never has this. */
const TYPED = /DATUM \d{2}\.\d{2}\.\d{4}, \d{2}\.\d{2} UHR/;
const CARD = /debitk\.|elv\d|kartenzahlung|sagt danke/i;

/**
 * Fold the spelling variants of one counterparty together.
 *
 * The same creditor arrives several ways: with its address appended after a run
 * of padding spaces, in upper or lower case, with the umlaut written out
 * ("Schaedlingsbekaempfung" against "Schadlingsbekampfung"), and occasionally
 * with a space inside a word ("KONR AD HILL"). Spaces are therefore dropped
 * entirely at the end — without that, METRO, PayPal and OpenTable each appear
 * twice and the list overstates how many creditors there are.
 */
const fold = s => (s ?? '')
  .split(/\s{2,}/)[0]                      // drop the address block
  .toLowerCase()
  .replace(/ä|ae/g, 'a').replace(/ö|oe/g, 'o').replace(/ü|ue/g, 'u').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\b(gmbh|ag|kg|co|ohg|se|sarl|et cie|s c a|deutschland|europe|limited|ltd|inh|jr)\b/g, '')
  .replace(/\s+/g, '').trim();

/** The Sparkasse's own fee for bouncing a debit — not a creditor. */
const BANK_FEE = /^entgelt /i;

const tx = await page(p => db.from('cashflow_transactions')
  .select('id, date, direction, counterparty, amount_cents, description')
  .order('id').range(p * 500, p * 500 + 499));

/* Ground truth: what the bank itself called each booking. */
const DIR = 'C:/Users/49172/Downloads';
const bankKind = new Map();
for (const f of fs.readdirSync(DIR).filter(f => /^Konto_0017148925-Auszug_2026_\d+\.PDF$/i.test(f))) {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(fs.readFileSync(path.join(DIR, f)))), { mergePages: true });
  const parsed = parseKontoauszug(text);
  if (parsed.balanced === false) continue;
  for (const e of parsed.entries) bankKind.set(`${e.date}|${Math.round(e.amount * 100)}`, e.kind);
}

const agg = new Map();
for (const t of tx) {
  if (t.direction === 'in') continue;
  const desc = t.description ?? '';
  if (CARD.test(desc) || BANK_FEE.test(t.counterparty ?? '')) continue;
  const k = fold(t.counterparty);
  if (!k) continue;
  const a = agg.get(k) ?? {
    names: new Set(), collected: 0, collectedSum: 0, transferred: 0, transferredSum: 0,
    gid: null, mandateRef: null, bankSaysDebit: 0, bankSaysTransfer: 0, first: t.date, last: t.date,
  };
  a.names.add((t.counterparty ?? '').trim());

  const gid = desc.match(GLAEUBIGER);
  if (gid && !a.gid) {
    a.gid = gid[1];
    a.mandateRef = (desc.match(/\b(SEPA[A-Z0-9]{6,})\b/) ?? [])[1] ?? null;
  }

  const kind = bankKind.get(`${t.date}|${-Math.abs(t.amount_cents)}`);
  if (kind === 'Lastschrift') a.bankSaysDebit++;
  else if (kind === 'Überweisung') a.bankSaysTransfer++;

  const v = Math.abs(t.amount_cents) / 100;
  if (TYPED.test(desc)) { a.transferred++; a.transferredSum += v; }
  else { a.collected++; a.collectedSum += v; }

  if (t.date < a.first) a.first = t.date;
  if (t.date > a.last) a.last = t.date;
  agg.set(k, a);
}

const name = a => [...a.names].sort((x, y) => y.length - x.length)[0];
/* One unexplained booking is not a mandate; a Gläubiger-ID or the bank's own
   word is, however often it happened. */
const mandated = [...agg.values()]
  .filter(a => a.gid || a.bankSaysDebit > 0 || a.collected >= 2)
  .sort((x, y) => y.collectedSum - x.collectedSum);

const evidence = a => a.gid ? 'Gläubiger-ID' : a.bankSaysDebit ? 'Kontoauszug' : 'narrative';

console.log(`# SEPA-Lastschriftmandate — ${mandated.length} counterparties collect from the account\n`);
console.log('    collected          total €   evidence       last        counterparty');
for (const a of mandated)
  console.log(`  ${String(a.collected).padStart(5)}x  ${eur(a.collectedSum).padStart(14)}   ${evidence(a).padEnd(13)}  ${a.last}  ${name(a)}`);

console.log('\n\n## Mandates proven by a Gläubiger-ID in the bank narrative');
for (const a of mandated.filter(a => a.gid))
  console.log(`  ${name(a).padEnd(44)} ${a.gid}${a.mandateRef ? `  Mandat ${a.mandateRef}` : ''}`);

console.log('\n\n## Both collected and transferred — worth knowing which is which');
for (const a of mandated.filter(a => a.transferred > 0).sort((x, y) => y.transferred - x.transferred))
  console.log(`  ${name(a).slice(0, 44).padEnd(46)} ${String(a.collected).padStart(3)} collected / ${String(a.transferred).padStart(3)} transferred (${eur(a.transferredSum)} €)`);

console.log('\n\n## No mandate — we pay these by hand (top 20 by value, excluding wages)');
const WAGES = /,|peters|simon|ortiz|costa|silva|rivero|benitez|perez|melchor/i;
const manual = [...agg.values()].filter(a => !a.gid && !a.bankSaysDebit && a.collected < 2 && a.transferred >= 2)
  .filter(a => !WAGES.test(name(a)))
  .sort((x, y) => y.transferredSum - x.transferredSum).slice(0, 20);
for (const a of manual)
  console.log(`  ${eur(a.transferredSum).padStart(13)} €  ${String(a.transferred).padStart(3)}x  ${name(a)}`);
