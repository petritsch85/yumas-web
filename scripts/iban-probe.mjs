/**
 * Can an IBAN be read off the invoices without a model?
 *
 * An IBAN is not a judgement call: it is a fixed shape with a checksum, so a
 * regular expression plus mod-97 finds it exactly or not at all. That matters
 * at this volume — 1.288 invoices have a PDF and no IBAN on file, and reading
 * each with a large model would be slow, expensive and no more accurate than
 * arithmetic.
 *
 * What a model WOULD be needed for is deciding which IBAN on the page belongs
 * to the creditor when there are several. This measures how often that
 * actually happens before anybody builds for it.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { extractText, getDocumentProxy } from 'unpdf';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/** Our own account: it appears on invoices as the debtor and is never a payee. */
const OURS = 'DE98560501800017148925';

const normalise = s => String(s ?? '').replace(/\s+/g, '').toUpperCase();

/** mod-97 — the whole reason this needs no model. */
function validIban(raw) {
  const i = normalise(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(i)) return false;
  const re = i.slice(4) + i.slice(0, 4);
  const digits = re.replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const d of digits) rem = (rem * 10 + Number(d)) % 97;
  return rem === 1;
}

/* IBANs are printed with spaces as often as not, so the pattern allows them
   and the checksum throws out whatever that over-matches. */
const IBAN_RE = /\b([A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{2,4}){2,8})\b/g;

const limit = Number(process.argv[2] ?? 25);
const { data: bills } = await db.from('bills')
  .select('id,supplier_name,invoice_number,file_path')
  .is('creditor_iban', null).not('file_path', 'is', null)
  .order('invoice_date', { ascending: false }).limit(limit);

let one = 0, several = 0, none = 0, failed = 0;
const multi = [];

for (const b of bills ?? []) {
  try {
    const { data: file, error } = await db.storage.from('bills').download(b.file_path);
    if (error || !file) { failed++; continue; }
    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buf);
    const { text } = await extractText(pdf, { mergePages: true });

    const hits = [...new Set([...String(text).matchAll(IBAN_RE)]
      .map(m => normalise(m[1]))
      .filter(validIban)
      .filter(i => i !== OURS))];

    if (hits.length === 0) { none++; console.log(`  —  ${String(b.supplier_name).slice(0, 34).padEnd(34)} keine IBAN gefunden`); }
    else if (hits.length === 1) { one++; console.log(`  ✔  ${String(b.supplier_name).slice(0, 34).padEnd(34)} ${hits[0]}`); }
    else {
      several++;
      multi.push({ supplier: b.supplier_name, hits });
      console.log(`  ?  ${String(b.supplier_name).slice(0, 34).padEnd(34)} ${hits.length} IBANs: ${hits.join(' / ')}`);
    }
  } catch (e) {
    failed++;
    console.log(`  ✘  ${String(b.supplier_name).slice(0, 34).padEnd(34)} ${String(e.message).slice(0, 50)}`);
  }
}

const n = bills?.length ?? 0;
console.log(`\n${n} Rechnungen geprüft`);
console.log(`   genau eine IBAN   ${one}  (${((one / n) * 100).toFixed(0)} %)`);
console.log(`   mehrere IBANs     ${several}  → braucht eine Entscheidung`);
console.log(`   keine gefunden    ${none}  (Scan ohne Textebene, oder wirklich keine)`);
console.log(`   nicht lesbar      ${failed}`);
