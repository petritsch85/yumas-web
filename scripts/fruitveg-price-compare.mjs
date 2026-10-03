/**
 * What the same produce costs from each supplier, month by month.
 *
 * Four suppliers price on different bases: Hills bills by the kilo, FFD by the
 * Kiste, Metro by the pack, Fruveg by either. A raw unit_price comparison would
 * be meaningless, so a pack size is read out of the wording wherever it is
 * stated and everything is brought to one kilo. A line whose base cannot be
 * established is reported as unusable rather than guessed at.
 *
 * Prices are only ever compared inside the same calendar month. Produce moves
 * with the season, and limes in August say nothing about limes in March.
 *
 *   node scripts/fruitveg-price-compare.mjs
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { classifyLine } from '../lib/food-categories.ts';

const root = path.resolve(import.meta.dirname, '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const page = async build => { const o = []; for (let p = 0; ; p++) { const { data, error } = await build(p); if (error) throw error; o.push(...data); if (data.length < 1000) return o; } };
const eur = n => Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = s => Number(String(s).replace(',', '.'));

const SUPPLIERS = ['Hills', 'Fruveg', 'FFD', 'Metro'];
const supplierOf = n => {
  const s = String(n ?? '').toLowerCase();
  if (/hills|schneble/.test(s)) return 'Hills';
  if (/fruveg|ataturabi/.test(s)) return 'Fruveg';
  if (/ffd|frisch fruchtig/.test(s)) return 'FFD';
  if (/metro/.test(s)) return 'Metro';
  return null;
};

/**
 * Fresh, prepped or preserved — the three are not the same purchase.
 *
 * Without this the comparison is nonsense: Metro's "PIZZATOMATEN POLPA DS" is a
 * tin of pulp at 1,54/kg and Hills' "Tomaten - A 47 +" is fresh fruit at 11,24,
 * and calling that a 638% price difference would send you to the wrong
 * supplier. Only the same form may be compared on price; fresh against prepped
 * is a question about convenience, and worth asking separately.
 */
const FORM = [
  [/\bds\b|dose|polpa|konserv|passata|pürier|puriert|tk\b|tiefk[üu]hl|gefr\b|pulp|p[üu]ree|saft|juice/i, 'preserved'],
  [/gew[üu]rfelt|w[üu]rfel|gestiftelt|streifen|scheiben|geschnitten|geschält|gesch[äa]lt|geraspelt|mix\b|lose geschnitten|rte\b|ready to eat/i, 'prepped'],
];
const formOf = d => { for (const [re, f] of FORM) if (re.test(String(d ?? ''))) return f; return 'fresh'; };

const TOKENS = [['limette', 'Limetten'], ['avocado', 'Avocado'], ['zucchini', 'Zucchini'],
  ['gurke', 'Gurken'], ['tomatillo', 'Tomatillos'], ['tomate', 'Tomaten'], ['zwiebel', 'Zwiebeln'],
  ['karotte', 'Karotten'], ['kartoffel', 'Kartoffeln'], ['koriander', 'Koriander'],
  ['paprika', 'Paprika'], ['mango', 'Mango'], ['ananas', 'Ananas'], ['melone', 'Melonen'],
  ['knoblauch', 'Knoblauch'], ['ingwer', 'Ingwer'], ['minze', 'Minze'], ['blumenkohl', 'Blumenkohl']];
const productOf = d => { const s = String(d ?? '').toLowerCase(); for (const [k, l] of TOKENS) if (s.includes(k)) return l; return null; };

/**
 * Kilos in one invoiced unit, or null when the wording does not say.
 *
 * "Zucchini Kiste (5 kg)" is five kilos a case; "1kg MC AVOCADO PULP" is one;
 * "Avocado - RTE" says nothing, and for Hills that is because the quantity is
 * itself the weight — which is why fractional quantities like 31,6 appear.
 */
function kilosPerUnit(desc, supplier) {
  const d = String(desc ?? '').toLowerCase();
  let m;
  /* Herbs are sold in bunches and "20er" is twenty of them, not twenty kilos.
     Read as weight it made Fruveg's coriander look like 1,50 €/kg against
     Hills at 22,99 — a 1.433% difference that does not exist. A bunch is 100 g,
     which is what FFD states outright. */
  if (/\bkr[äa]uter|bund\b/.test(d)) {
    if ((m = d.match(/\((\d+)\s*g\s*bund\)/))) return num(m[1]) / 1000;
    if ((m = d.match(/\b(\d+)er\b/))) return num(m[1]) * 0.1;
    return 0.1;
  }
  /* "7er", "24er" on fruit is a count, not a weight. A pineapple is not 700 g
     and a case of 24 avocados is not 2,4 kg, so rather than invent a weight
     these are left out of the comparison entirely. */
  if (/\b\d+er\b/.test(d) || /st[üu]ck/.test(d)) {
    if ((m = d.match(/\(\s*(?:ca\.\s*)?(\d+[.,]?\d*)\s*(?:-\s*(\d+[.,]?\d*))?\s*kg\s*\)/))) {
      return m[2] ? (num(m[1]) + num(m[2])) / 2 : num(m[1]);   // "(ca. 4-6kg)"
    }
    return null;
  }
  if ((m = d.match(/\(\s*(?:ca\.\s*)?(\d+[.,]?\d*)\s*(?:-\s*\d+[.,]?\d*)?\s*kg\s*\)/))) return num(m[1]);
  if ((m = d.match(/(\d+[.,]?\d*)\s*kg\b/)))          return num(m[1]);   // 2,5kg …
  if ((m = d.match(/(\d+[.,]?\d*)\s*g\b/)))           return num(m[1]) / 1000;
  /* Hills and Fruveg invoice loose produce by weight, so one unit is one kilo. */
  if (supplier === 'Hills' || supplier === 'Fruveg') return 1;
  return null;                                                            // pieces, cases of unknown weight
}

/** A price this far from the product's own median is an extraction slip. */
const OUTLIER = 4;

const bills = (await page(p => db.from('bills')
  .select('id,invoice_date,supplier_name,category').gte('invoice_date', '2026-01-01')
  .order('id').range(p * 1000, p * 1000 + 999)))
  .filter(b => ['Food Cost', 'Drinks Cost', 'Packaging'].includes(b.category) && supplierOf(b.supplier_name));
const byId = new Map(bills.map(b => [b.id, b]));
const lines = (await page(p => db.from('bill_lines')
  .select('bill_id,description,quantity,unit_price,line_total').order('id').range(p * 1000, p * 1000 + 999)))
  .filter(l => byId.has(l.bill_id) && classifyLine(String(l.description ?? '')) === 'Fruit & Veg');

/* product -> month -> supplier -> {kg, spend, examples} */
const data = {};
let unusable = 0, unusableSpend = 0;
for (const l of lines) {
  const product = productOf(l.description);
  if (!product) continue;
  const b = byId.get(l.bill_id);
  const supplier = supplierOf(b.supplier_name);
  const qty = Number(l.quantity ?? 0);
  const total = Number(l.line_total ?? 0);
  if (qty <= 0 || total <= 0) continue;
  const kg = kilosPerUnit(l.description, supplier);
  if (kg === null || kg <= 0) { unusable++; unusableSpend += total; continue; }
  const month = String(b.invoice_date).slice(0, 7);
  const key = `${product} · ${formOf(l.description)}`;
  const bucket = (((data[key] ??= {})[month] ??= {})[supplier] ??= { kg: 0, spend: 0, ex: new Map(), prices: [] });
  bucket.kg += qty * kg;
  bucket.spend += total;
  bucket.prices.push(total / (qty * kg));
  bucket.ex.set(String(l.description).slice(0, 44), total / (qty * kg));
}

/* Drop the lines whose unit price is wildly off the product's own median:
   those are misread quantities, not bargains. Hills' April avocado came out at
   0,50 €/kg on 3.942 kg, which is thirteen times the volume of any other month. */
for (const months of Object.values(data)) {
  const all = Object.values(months).flatMap(sup => Object.values(sup).flatMap(x => x.prices)).sort((a, b) => a - b);
  if (all.length < 4) continue;
  const median = all[Math.floor(all.length / 2)];
  for (const sup of Object.values(months)) {
    for (const [name, x] of Object.entries(sup)) {
      const keep = x.prices.filter(p => p <= median * OUTLIER && p >= median / OUTLIER);
      if (keep.length === 0) { delete sup[name]; continue; }
      if (keep.length !== x.prices.length) {
        /* Rebuild from the lines that survived, so the average is not dragged. */
        const share = keep.reduce((s, p) => s + p, 0) / keep.length;
        x.spend = share * x.kg * (keep.length / x.prices.length);
        x.kg = x.kg * (keep.length / x.prices.length);
      }
    }
  }
}

console.log(`${lines.length} Fruit & Veg lines from the four suppliers`);
console.log(`${unusable} lines (${eur(unusableSpend)} €) priced by the piece or an unstated pack — left out\n`);

const rows = [];
for (const [product, months] of Object.entries(data)) {
  for (const [month, sup] of Object.entries(months)) {
    const names = Object.keys(sup).filter(s => sup[s].kg > 0);
    if (names.length < 2) continue;       // nothing to compare in this month
    const priced = names.map(s => ({ s, p: sup[s].spend / sup[s].kg, kg: sup[s].kg, spend: sup[s].spend,
      ex: [...sup[s].ex.keys()][0] }));
    priced.sort((a, z) => a.p - z.p);
    rows.push({ product, month, priced,
      spread: (priced[priced.length - 1].p - priced[0].p) / priced[0].p * 100,
      kg: priced.reduce((t, x) => t + x.kg, 0) });
  }
}

/* Where the same thing was bought from two suppliers in the same month. */
const byProduct = {};
for (const r of rows) (byProduct[r.product] ??= []).push(r);

console.log('Same product, same month, more than one supplier\n');
for (const [product, rs] of Object.entries(byProduct)
  .sort((a, z) => z[1].reduce((s, r) => s + r.kg, 0) - a[1].reduce((s, r) => s + r.kg, 0))) {
  const avgSpread = rs.reduce((s, r) => s + r.spread, 0) / rs.length;
  console.log(`=== ${product}  — ${rs.length} month(s) with a real overlap, average spread ${avgSpread.toFixed(0)}%`);
  for (const r of rs.sort((a, z) => a.month < z.month ? -1 : 1)) {
    console.log(`   ${r.month}  ` + r.priced.map(x => `${x.s} ${eur(x.p)}/kg (${x.kg.toFixed(0)}kg)`).join('   vs   ')
      + `   spread ${r.spread.toFixed(0)}%`);
  }
  const ex = rs[0].priced.map(x => `${x.s}: "${x.ex}"`).join('  |  ');
  console.log(`      wording: ${ex}\n`);
}
