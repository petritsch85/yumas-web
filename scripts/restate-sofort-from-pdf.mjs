/**
 * Finds "zahlbar sofort" in the invoice itself, not just in payment_method.
 *
 * The first pass over these bills read the terms we had already stored. Where
 * extraction never captured them — Bad Homburger Brauhaus prints "Ohne Abzug
 * sofort fällig" and payment_method came back null — the bill kept a due date
 * equal to its invoice date and the fortnight was never applied.
 *
 * So the invoice is re-read. Only bills whose due date is the invoice date
 * itself, or a week after, are considered: those are the two shapes the old
 * assumption produced. A supplier's own printed deadline is never moved, and
 * the terms found are written back so the next pass need not open the PDF.
 *
 *   node scripts/restate-sofort-from-pdf.mjs --dry
 *   node scripts/restate-sofort-from-pdf.mjs
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { extractText, getDocumentProxy } from 'unpdf';

const root = path.resolve(import.meta.dirname, '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const SOFORT_DAYS = 14;
/**
 * "sofort" has to be standing in for a deadline, not merely present.
 *
 * Three ways it appears without being a payment term, all of them seen here:
 * Nacho Kings announce a delivery fee "ab sofort" while granting 7 days;
 * Edenred say the amount falls due at once *should a direct debit bounce*;
 * and "ohne Abzug" on its own is about discount, not timing. So the word must
 * be paired with the act of paying, and the sentence must not be a warning
 * about what happens later.
 */
const TERM_SOFORT = /zahlbar\s+sofort|sofort\s+(?:zahlbar|f[äa]llig|rein\s+netto|zu\s+zahlen)|(?:zahlbar|f[äa]llig)\s+(?:bei|nach)\s+erhalt|netto\s+kasse|payable\s+immediately|due\s+(?:up)?on\s+receipt/i;
/** Makes the clause a consequence of non-payment rather than the term. */
const CONDITIONAL = /r[üu]cklastschrift|verzug|mahn|zahlungserinnerung|sollte\s+es|nicht\s+(?:rechtzeitig|fristgerecht)|versp[äa]tet/i;
/* A real deadline stated in days wins over "sofort" wherever both appear. */
const NET_DAYS = /(?:innerhalb\s*(?:von\s*)?)?(\d{1,3})\s*(?:kalender)?tage?n?\s*(?:netto|nach\s*rechnungs|ab\s*rechnungs)|\bnetto\s*(\d{1,3})\s*tage|zahlungsziel\s*:?\s*(\d{1,3})\s*tage/i;
/* Any day count in the terms we already hold settles it — Nacho Kings' stored
   "7Tage (bis 07.10.2026)" is the supplier's own deadline, not an assumption. */
const STORED_DAYS = /\d{1,3}\s*tage?n?\b/i;
const DERIVED_LAGS = new Set([0, 7]);

const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const lagOf = b => (b.invoice_date && b.due_date) ? Math.round((new Date(b.due_date) - new Date(b.invoice_date)) / 86400000) : null;

const dry = process.argv.includes('--dry');
const pageAll = async build => { const o = []; for (let p = 0; ; p++) { const { data, error } = await build(p); if (error) throw error; o.push(...data); if (data.length < 500) return o; } };

const bills = await pageAll(p => db.from('bills')
  .select('id, supplier_name, invoice_number, invoice_date, due_date, due_date_source, payment_method, file_path')
  .order('id').range(p * 500, p * 500 + 499));

/* Already handled by the pass that read payment_method. */
const candidates = bills.filter(b =>
  b.file_path && b.invoice_date && DERIVED_LAGS.has(lagOf(b))
  /* Only the stated deadline excuses a bill from being re-read. A lag of 0 or
     7 days is the old assumption whatever the terms field happens to say. */
  && !STORED_DAYS.test(b.payment_method ?? ''));

console.log(`${bills.length} bills · ${candidates.length} to re-read${dry ? ' (dry run)' : ''}\n`);

const plan = [];
let read = 0, failed = 0;
for (const b of candidates) {
  let flat = '';
  try {
    const { data: f, error } = await db.storage.from('bills').download(b.file_path);
    if (error) throw new Error(error.message);
    const pdf = await getDocumentProxy(new Uint8Array(await f.arrayBuffer()));
    flat = (await extractText(pdf, { mergePages: true })).text.replace(/\s+/g, ' ');
    read++;
  } catch { failed++; continue; }

  if (NET_DAYS.test(flat)) continue;        // a stated deadline: leave it alone
  const hit = flat.match(TERM_SOFORT);
  if (!hit) continue;
  /* Judge the sentence the term sits in, not the whole invoice. */
  const around = flat.slice(Math.max(0, hit.index - 120), hit.index + 120);
  if (CONDITIONAL.test(around)) continue;

  plan.push({ b, to: addDays(b.invoice_date, SOFORT_DAYS), quote: around.slice(60, 190).trim() });
}

console.log(`read ${read} · unreadable ${failed} · say sofort and are still on the old assumption: ${plan.length}\n`);
const bySupplier = {};
for (const x of plan) (bySupplier[(x.b.supplier_name ?? '—').slice(0, 32)] ??= []).push(x);
for (const [s, v] of Object.entries(bySupplier).sort((a, z) => z[1].length - a[1].length)) {
  const e = v[0];
  console.log(`  ${String(v.length).padStart(3)}x  ${s.padEnd(34)} e.g. ${e.b.invoice_date} ${e.b.due_date} -> ${e.to}`);
  console.log(`        "${e.quote.slice(0, 76)}"`);
}

if (dry) { console.log('\n(dry run — nothing written)'); process.exit(0); }
let done = 0;
for (const { b, to, quote } of plan) {
  const { error } = await db.from('bills').update({
    due_date: to,
    due_date_source: 'stated-term',
    /* Keep what the invoice actually said, so this never needs reading again. */
    payment_method: b.payment_method ?? quote.slice(0, 120),
  }).eq('id', b.id);
  if (error) console.error(`  FAILED ${b.invoice_number}: ${error.message}`);
  else done++;
}
console.log(`\nrestated ${done} bill(s) to invoice date + ${SOFORT_DAYS} days`);
