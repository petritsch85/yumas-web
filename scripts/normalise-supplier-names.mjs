/**
 * One spelling per supplier on the bills table.
 *
 * The extraction model copies the supplier's name off the page, and the page
 * is not consistent: Bier-Zentrale Leleithner invoices its own name six
 * different ways — casing, a missing "GmbH", and a trailing
 * "Getränkegrosshandel und Gastronomiepartner" the prompt explicitly tells the
 * model not to append. Every spelling then counts as a separate supplier, so a
 * cost breakdown shows one merchant as two or three lines.
 *
 * Only provable variants are merged:
 *
 *   - names identical once case, spaces and punctuation are ignored
 *   - names where one is a prefix of another and the shared part is at least
 *     PREFIX_MIN characters — "bierzentraleleleithner" inside
 *     "bierzentraleleleithnergmbhgetraenkegrosshandel…"
 *
 * That is deliberately short of merging names that merely look related.
 * "Werz GmbH" and "Werz Wurst - Fleisch - Convenience GmbH" may well be one
 * business, but the strings do not prove it and this script will not guess —
 * it reports them instead.
 *
 *   node scripts/normalise-supplier-names.mjs --dry   # report, change nothing
 *   node scripts/normalise-supplier-names.mjs         # write
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(import.meta.dirname, '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

/** A prefix shorter than this proves nothing — "werzgmbh" is inside plenty. */
const PREFIX_MIN = 12;

const norm = s => String(s ?? '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]/g, '');

const dry = process.argv.includes('--dry');

const pageAll = async build => { const o = []; for (let p = 0; ; p++) { const { data, error } = await build(p); if (error) throw error; o.push(...data); if (data.length < 500) return o; } };
const bills = await pageAll(p => db.from('bills')
  .select('id, supplier_name, gross_amount').order('id').range(p * 500, p * 500 + 499));

/* Count every spelling actually in use. */
const spellings = new Map();   // exact name -> { n, gross }
for (const b of bills) {
  const name = String(b.supplier_name ?? '').trim();
  if (!name) continue;
  const cur = spellings.get(name) ?? { n: 0, gross: 0 };
  cur.n++; cur.gross += Number(b.gross_amount ?? 0);
  spellings.set(name, cur);
}

/* Union spellings that are the same string, or one a prefix of the other. */
const names = [...spellings.keys()];
const parent = new Map(names.map(n => [n, n]));
const find = n => { while (parent.get(n) !== n) { parent.set(n, parent.get(parent.get(n))); n = parent.get(n); } return n; };
const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const a = norm(names[i]), b = norm(names[j]);
    if (!a || !b) continue;
    if (a === b) { union(names[i], names[j]); continue; }
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    if (short.length >= PREFIX_MIN && long.startsWith(short)) union(names[i], names[j]);
  }
}

const groups = new Map();
for (const n of names) {
  const r = find(n);
  groups.set(r, [...(groups.get(r) ?? []), n]);
}

let changed = 0, billsTouched = 0;
const plan = [];
for (const members of groups.values()) {
  if (members.length < 2) continue;
  /* The spelling the most invoices use wins. Ties are broken on readability
     first — an invoice shouting its own name in capitals is a typesetting
     choice, not a name — and then on length, where the shorter drops a
     tagline. The exception is a difference of a character or two, which is
     punctuation rather than a tagline: "Jung Vakuumtechnik e.K." is the name
     and "Jung Vakuumtechnik e.K" is it with the full stop lost. */
  const shouty = s => s === s.toUpperCase() && /[A-Z]/.test(s);
  const ranked = members
    .map(n => ({ name: n, ...spellings.get(n) }))
    .sort((a, z) => {
      if (z.n !== a.n) return z.n - a.n;
      if (shouty(a.name) !== shouty(z.name)) return shouty(a.name) ? 1 : -1;
      const [s, l] = a.name.length <= z.name.length ? [a, z] : [z, a];
      const punctuationOnly = norm(l.name).startsWith(norm(s.name))
        && l.name.length - s.name.length <= 3;
      return punctuationOnly ? (a === l ? -1 : 1) : a.name.length - z.name.length;
    });
  const canonical = ranked[0].name;
  const losers = ranked.slice(1);
  plan.push({ canonical, losers });
  changed++;
  billsTouched += losers.reduce((t, l) => t + l.n, 0);
}

console.log(`${bills.length} bills · ${names.length} spellings · ${changed} supplier(s) split across spellings${dry ? ' (dry run)' : ''}\n`);
for (const { canonical, losers } of plan) {
  console.log(`  keep  ${JSON.stringify(canonical)}  (${spellings.get(canonical).n} bills)`);
  for (const l of losers) console.log(`  <-    ${JSON.stringify(l.name)}  (${l.n} bills, ${Math.round(l.gross)} EUR)`);
  console.log('');
}

if (!dry) {
  for (const { canonical, losers } of plan) {
    for (const l of losers) {
      const { error } = await db.from('bills').update({ supplier_name: canonical }).eq('supplier_name', l.name);
      if (error) console.error(`  FAILED ${l.name}: ${error.message}`);
    }
  }
  console.log(`rewrote ${billsTouched} bill(s)`);
} else {
  console.log(`would rewrite ${billsTouched} bill(s)`);
}

/* Names that look related but are not provably the same — reported, never touched. */
const roots = [...groups.keys()].map(r => ({ root: r, key: norm(r) }));
const suspicious = [];
for (let i = 0; i < roots.length; i++) {
  for (let j = i + 1; j < roots.length; j++) {
    const a = roots[i].key, b = roots[j].key;
    const stem = Math.min(a.length, b.length) >= 6 ? a.slice(0, 6) === b.slice(0, 6) : false;
    if (stem) suspicious.push([roots[i].root, roots[j].root]);
  }
}
if (suspicious.length) {
  console.log('\nLeft alone — same opening but not provably one supplier:');
  for (const [a, b] of suspicious) console.log(`   ${JSON.stringify(a)}  vs  ${JSON.stringify(b)}`);
}
