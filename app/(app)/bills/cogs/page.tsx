'use client';

/**
 * Cost of goods, by supplier and by product, month across the top.
 *
 * Two readings of the same money. By supplier it is the net of the bills, the
 * figure the P&L COGS line uses, so the two pages tie. By product it is the net
 * of the invoice lines, which comes to a little more — the lines of a bill do
 * not always add to its own net, and that difference is shown rather than
 * smoothed away.
 *
 * Only Food Cost, Drinks Cost and Packaging. Everything else a supplier sends
 * is a cost of running the business, not of the goods sold.
 */

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { fetchAllRows } from '@/lib/fetch-all';
import { Package, ChevronRight, ChevronDown } from 'lucide-react';
import { classifyLine } from '@/lib/food-categories';

/** The three bill categories that are cost of goods, as the P&L uses them. */
const COGS_CATEGORIES = ['Food Cost', 'Drinks Cost', 'Packaging'];

/**
 * The four buckets, in the order they are shown.
 *
 * The shared classifier knows Fruit & Veg, Meat, Spices, Dairy and Leergut.
 * Non-food is not one of its answers, so it is assembled here: the crates and
 * empties it does recognise, plus anything on a Packaging bill, plus the
 * cleaning and hygiene goods that arrive among the food. Everything else
 * edible — spices, dairy, drinks — falls to Other.
 */
const BUCKETS = ['Meat', 'Fruit & Veg', 'Dairy', 'Drinks', 'Dry goods',
                'Oils, sauces & spices', 'Non-food', 'Delivery charges', 'Other'] as const;
type Bucket = typeof BUCKETS[number];

/**
 * Flatten a description before matching.
 *
 * The wholesalers write umlauts as two letters — MUELLS., LOEFFEL, GRILLBUERSTE,
 * TRENNBOEDEN, HAEHNCHEN — while the suppliers who send real invoices write
 * them properly. Matching both spellings in every pattern is how the keyword
 * lists grow unreadable, so the text is folded once and the patterns below are
 * written without umlauts.
 */
const flat = (s: string) => s.toLowerCase()
  .replace(/ä|ae/g, 'a').replace(/ö|oe/g, 'o').replace(/ü|ue/g, 'u').replace(/ß/g, 'ss');

/** Packaging and cleaning, which the food classifier would call Other. */
const NON_FOOD = /reinig|hygiene|spulmittel|putz|handschuh|mullbeutel|folie|serviette|besteck|becher|teller|schale|deckel|karton|verpackung|tute|beutel|papier|clean|wipe|towel|container|box\b/;
/** Things you do not sell: cleaning, bin bags, kitchen tools, crates. */
const NON_FOOD_GOODS = /mulls|toilettenpap|klorix|waschmittel|wischset|microfaser|burste|loffel|gabel\b|messer|mixer|siegelrand|trennbod|mehrwegkiste|kiste\b|tuch\b|spul/;
/** Freight, not goods — part of the cost, but not a thing on a shelf. */
const CHARGES = /versandkosten|liefergebuhr|shipping|fracht|zuschlag/;
const DRINKS = /bier|beer|cerveza|pils|lager|fass|cola|fanta|spezi|limo|schorle|wasser|water|selters|azur|mineral|saft|juice|tonic|mate\b|red bull|energy|wein|wine|vino|burgunder|riesling|tequila|mezcal|rum\b|vodka|gin\b|whisk|likor|prosecco|sekt|frizz|valmarone|espresso|kaffee|coffee|jever|paloma|corona|modelo|pacifico|cranberry|dpg|kasten|tray|pfand/;
/* \bol\b, not a bare "ol": "40% vol." would otherwise read as cooking oil. */
const OILS = /\bol\b|olivenol|rapsol|sonnenblumenol|speiseol|balsamico|condimento|essig|senf|mayonnaise|ketchup/;
const DRY = /tortilla|chips|reis\b|rice|zucker|sugar|mehl|flour|honig|marmelade|mus\b|sultana|rosine|linsen|nudel|pasta|brot|bread|ciabatta|glasur|konserv|sack\b|parboiled|kidney bohne|bohnen ds/;
/** Vegetables the shared classifier does not know, in flattened spelling. */
const VEG_EXTRA = /rote beete|beete\b/;

/**
 * Which bucket a line belongs to.
 *
 * Order matters. Freight first, because it is not a good at all. Then anything
 * on a Packaging bill. Then the shared classifier, whose answer is trusted over
 * any wording in the line: "Queso Oaxaca 2 Kg Tiras (3 Karton)" is cheese, and
 * the carton it travels in does not make it packaging. Only a line the
 * classifier cannot place is matched on wording, and drinks are tested before
 * dry goods so an Espresso does not land among the rice.
 */
function bucketFor(description: string, billCategory: string): Bucket {
  const d = flat(description);
  if (CHARGES.test(d)) return 'Delivery charges';
  if (billCategory === 'Packaging') return 'Non-food';

  const sub = classifyLine(description);
  if (sub === 'Meat')        return 'Meat';
  if (sub === 'Fruit & Veg') return 'Fruit & Veg';
  if (sub === 'Dairy')       return 'Dairy';
  if (sub === 'Spices')      return 'Oils, sauces & spices';
  if (sub === 'Leergut')     return 'Non-food';

  if (NON_FOOD_GOODS.test(d) || NON_FOOD.test(d)) return 'Non-food';
  if (VEG_EXTRA.test(d))  return 'Fruit & Veg';
  if (DRINKS.test(d))     return 'Drinks';
  if (OILS.test(d))       return 'Oils, sauces & spices';
  if (DRY.test(d))        return 'Dry goods';
  /* A line nobody could place, on a bill filed as drinks, is a drink. This
     catches the spirits, which arrive as brand names alone — Glenfiddich,
     Moët, Sarti Rosa — and would otherwise need a list of every bottle. */
  if (billCategory === 'Drinks Cost') return 'Drinks';
  return 'Other';
}

/**
 * One product from many spellings of it.
 *
 * The same good is written differently on every invoice — case, pack sizes,
 * order codes, trailing weights. Folding those away turns 2.375 descriptions
 * into something a person can read down, without inventing a catalogue.
 */
function productKey(description: string): string {
  return String(description ?? '')
    .toLowerCase()
    .replace(/\b\d+[.,]?\d*\s?(kg|g|l|ml|cl|stk|stck|st[üu]ck|x|er|%|cm|mm)\b/g, ' ')
    .replace(/\b\d+\s*[x*]\s*\d+\b/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')          // article numbers
    .replace(/[^a-zäöüß ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type Row = { label: string; byMonth: Record<string, number>; total: number };

/**
 * Roll-ups shown above a bucket's products.
 *
 * Fruit & Veg runs to 190 products and the same vegetable arrives under a dozen
 * spellings — avocado as RTE, as pulp, by the case, frozen. These lines gather
 * them so the total for one thing can be read at a glance. They summarise the
 * rows beneath and are never added to the bucket, or every product would count
 * twice.
 *
 * The exclusions matter more than the matches. "Salat" catches 3.751 € of salad
 * bowls and lids, which are packaging and already counted under Non-food;
 * "Koriander" catches the polystyrene it is shipped in; "Zwiebel" catches fried
 * onions, which are an ambient good rather than fresh veg. Each was checked
 * against the actual invoice lines before being written here.
 */
const SUMMARY_ITEMS: { bucket: Bucket; label: string; match: RegExp; exclude?: RegExp }[] = [
  { bucket: 'Fruit & Veg', label: 'Avocado',   match: /avocado/ },
  { bucket: 'Fruit & Veg', label: 'Salat',     match: /salat/,    exclude: /salatschale|deckel|mayon/ },
  { bucket: 'Fruit & Veg', label: 'Koriander', match: /koriander/, exclude: /\beps\b/ },
  { bucket: 'Fruit & Veg', label: 'Zwiebeln',  match: /zwiebel/,  exclude: /rostzwiebel/ },
];

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (n: number) => Math.round(n).toLocaleString('de-DE');
const LABEL_W = 260;

export default function CogsPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  /* Collapsed to start: nine buckets opened at once is a wall of products. */
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const { data: bills = [], isLoading: lb } = useQuery({
    queryKey: ['cogs-page', 'bills', year],
    queryFn: () => fetchAllRows<Record<string, unknown>>((from, to) => supabase.from('bills')
      .select('id,invoice_date,supplier_name,category,net_amount')
      .gte('invoice_date', `${year}-01-01`).lte('invoice_date', `${year}-12-31`)
      .order('id').range(from, to)),
  });
  const { data: lines = [], isLoading: ll } = useQuery({
    queryKey: ['cogs-page', 'lines'],
    queryFn: () => fetchAllRows<Record<string, unknown>>((from, to) => supabase.from('bill_lines')
      .select('bill_id,description,line_total').order('id').range(from, to)),
  });

  const model = useMemo(() => {
    const cogsBills = (bills as Record<string, unknown>[])
      .filter(b => COGS_CATEGORIES.includes(String(b.category ?? '')));
    const months = Array.from(new Set(cogsBills.map(b => String(b.invoice_date ?? '').slice(0, 7))))
      .filter(Boolean).sort();

    /* By supplier: the bill net, so this section ties to the P&L. */
    const bySupplier = new Map<string, Row>();
    for (const b of cogsBills) {
      const name = String(b.supplier_name ?? '—').trim();
      const key = name.toLowerCase();
      const m = String(b.invoice_date ?? '').slice(0, 7);
      const v = Number(b.net_amount ?? 0);
      const r = bySupplier.get(key) ?? { label: name, byMonth: {}, total: 0 };
      r.byMonth[m] = (r.byMonth[m] ?? 0) + v;
      r.total += v;
      bySupplier.set(key, r);
    }

    /* By product: the invoice lines, bucketed. */
    const billById = new Map(cogsBills.map(b => [String(b.id), b]));
    const byBucket = Object.fromEntries(BUCKETS.map(b => [b, new Map<string, Row>()])) as Record<Bucket, Map<string, Row>>;
    let lineTotal = 0;
    for (const l of lines as Record<string, unknown>[]) {
      const b = billById.get(String(l.bill_id));
      if (!b) continue;
      const desc = String(l.description ?? '').trim();
      if (!desc) continue;
      const m = String(b.invoice_date ?? '').slice(0, 7);
      const v = Number(l.line_total ?? 0);
      lineTotal += v;
      const bucket = bucketFor(desc, String(b.category ?? ''));
      const key = productKey(desc) || desc.toLowerCase();
      const map = byBucket[bucket];
      const r = map.get(key) ?? { label: desc, byMonth: {}, total: 0 };
      r.byMonth[m] = (r.byMonth[m] ?? 0) + v;
      r.total += v;
      map.set(key, r);
    }

    const billNet = cogsBills.reduce((s, b) => s + Number(b.net_amount ?? 0), 0);
    const monthNet: Record<string, number> = {};
    for (const b of cogsBills) {
      const m = String(b.invoice_date ?? '').slice(0, 7);
      monthNet[m] = (monthNet[m] ?? 0) + Number(b.net_amount ?? 0);
    }
    const monthLines: Record<string, number> = {};
    for (const bucket of BUCKETS) for (const r of byBucket[bucket].values())
      for (const [m, v] of Object.entries(r.byMonth)) monthLines[m] = (monthLines[m] ?? 0) + v;

    return {
      months,
      suppliers: [...bySupplier.values()].sort((a, z) => z.total - a.total),
      buckets: BUCKETS.map(b => {
        const rows = [...byBucket[b].values()].sort((a, z) => z.total - a.total);
        /* Built from the rows above, so a summary can never disagree with the
           products it stands for, and never adds to the bucket. */
        const summaries: Row[] = SUMMARY_ITEMS.filter(s => s.bucket === b).map(s => {
          const hits = rows.filter(r => {
            const f = flat(r.label);
            return s.match.test(f) && !(s.exclude?.test(f) ?? false);
          });
          const byMonth: Record<string, number> = {};
          for (const r of hits) for (const [m, v] of Object.entries(r.byMonth)) byMonth[m] = (byMonth[m] ?? 0) + v;
          return { label: `${s.label} · ${hits.length}`, byMonth, total: hits.reduce((t, r) => t + r.total, 0) };
        }).filter(r => r.total !== 0);
        return {
          bucket: b,
          rows,
          summaries,
          total: rows.reduce((s, r) => s + r.total, 0),
          byMonth: rows.reduce<Record<string, number>>((acc, r) => {
            for (const [m, v] of Object.entries(r.byMonth)) acc[m] = (acc[m] ?? 0) + v;
            return acc;
          }, {}),
        };
      }),
      billNet, lineTotal, monthNet, monthLines,
    };
  }, [bills, lines]);

  const cols = model.months;
  const cell = (v: number | undefined) =>
    v === undefined || v === 0 ? <span className="text-gray-300">—</span> : fmt(v);

  const headRow = (
    <tr style={{ backgroundColor: '#111827' }}>
      <th className="sticky left-0 z-20 px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider border-r border-gray-700"
        style={{ backgroundColor: '#111827', minWidth: LABEL_W, width: LABEL_W }}>Cost of goods</th>
      {cols.map(m => (
        <th key={m} className="px-2 py-3 text-right text-xs font-semibold text-gray-300 whitespace-nowrap"
          style={{ minWidth: 78 }}>{MONTH_ABBR[Number(m.slice(5)) - 1]} {m.slice(2, 4)}</th>
      ))}
      <th className="px-3 py-3 text-right text-xs font-semibold text-amber-200 whitespace-nowrap"
        style={{ minWidth: 92 }}>FY {year}</th>
    </tr>
  );

  const section = (title: string) => (
    <tr style={{ backgroundColor: '#eef2ff' }} className="border-b border-gray-200">
      <td className="sticky left-0 z-10 px-4 py-1.5 text-xs font-bold text-gray-800 border-r border-gray-100"
        style={{ backgroundColor: '#eef2ff' }}>{title}</td>
      {cols.map(m => <td key={m} style={{ backgroundColor: '#eef2ff' }} />)}
      <td style={{ backgroundColor: '#eef2ff' }} />
    </tr>
  );

  const dataRow = (r: Row, opts: { bold?: boolean; indent?: boolean } = {}) => (
    <tr key={(opts.bold ? 'b-' : '') + r.label} className="border-b border-gray-100 hover:bg-gray-50/60 group">
      <td className={'sticky left-0 z-10 px-4 border-r border-gray-100 bg-white group-hover:bg-gray-50 truncate '
        + (opts.bold ? 'py-1.5 text-xs font-bold text-gray-800' : 'py-1 text-[11px] text-gray-600')
        + (opts.indent ? ' pl-8' : '')}
        style={{ maxWidth: LABEL_W }} title={r.label}>{r.label}</td>
      {cols.map(m => (
        <td key={m} className={'text-right tabular-nums px-2 ' + (opts.bold ? 'py-1.5 text-xs font-bold' : 'py-1 text-[11px]')}>
          {cell(r.byMonth[m])}
        </td>
      ))}
      <td className={'text-right tabular-nums px-3 ' + (opts.bold ? 'py-1.5 text-xs font-bold' : 'py-1 text-[11px]')}
        style={{ backgroundColor: '#fffbeb', borderLeft: '1px solid #fde68a' }}>{cell(r.total)}</td>
    </tr>
  );

  const loading = lb || ll;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Package size={20} /> COGS</h1>
          <p className="text-xs text-gray-500">Cost of goods by supplier and by product · Food, Drinks and Packaging only</p>
        </div>
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white">
          {[year + 1, year, year - 1, year - 2].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
      ) : cols.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2 border border-dashed border-gray-200 rounded-xl">
          <Package size={28} className="text-gray-200" />
          <p className="text-sm">No cost-of-goods bills in {year}</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
            <table className="text-xs border-collapse" style={{ minWidth: LABEL_W + cols.length * 78 + 92 }}>
              <thead className="sticky top-0 z-30">{headRow}</thead>
              <tbody>
                {section('By supplier')}
                {model.suppliers.map(r => dataRow(r, { indent: true }))}
                {dataRow({
                  label: 'Total COGS', total: model.billNet,
                  byMonth: model.monthNet,
                }, { bold: true })}

                <tr style={{ height: 10 }}><td className="bg-white sticky left-0 border-r border-gray-100" />{cols.map(m => <td key={m} className="bg-white" />)}<td className="bg-white" /></tr>

                {section('By product')}
                {model.buckets.map(b => (
                  <React.Fragment key={b.bucket}>
                    <tr className="border-b border-gray-100 bg-gray-50 cursor-pointer hover:bg-gray-100"
                      onClick={() => setOpen(o => ({ ...o, [b.bucket]: !o[b.bucket] }))}>
                      <td className="sticky left-0 z-10 px-4 py-1.5 text-xs font-bold text-gray-800 border-r border-gray-100 bg-gray-50">
                        <span className="inline-flex items-center gap-1">
                          {open[b.bucket] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          {b.bucket}
                          <span className="font-normal text-gray-400">· {b.rows.length}</span>
                        </span>
                      </td>
                      {cols.map(m => <td key={m} className="text-right tabular-nums px-2 py-1.5 text-xs font-bold">{cell(b.byMonth[m])}</td>)}
                      <td className="text-right tabular-nums px-3 py-1.5 text-xs font-bold"
                        style={{ backgroundColor: '#fffbeb', borderLeft: '1px solid #fde68a' }}>{cell(b.total)}</td>
                    </tr>
                    {open[b.bucket] && b.summaries.map(r => (
                      <tr key={'sum-' + b.bucket + r.label} className="border-b border-indigo-100"
                        style={{ backgroundColor: '#f5f3ff' }}>
                        <td className="sticky left-0 z-10 px-4 py-1 pl-8 text-[11px] font-semibold text-indigo-900 border-r border-gray-100 truncate"
                          style={{ backgroundColor: '#f5f3ff', maxWidth: LABEL_W }}
                          title="Sums the matching products below — not an extra cost">
                          Σ {r.label}
                        </td>
                        {cols.map(m => (
                          <td key={m} className="text-right tabular-nums px-2 py-1 text-[11px] font-semibold text-indigo-900"
                            style={{ backgroundColor: '#f5f3ff' }}>{cell(r.byMonth[m])}</td>
                        ))}
                        <td className="text-right tabular-nums px-3 py-1 text-[11px] font-semibold text-indigo-900"
                          style={{ backgroundColor: '#f5f3ff', borderLeft: '1px solid #fde68a' }}>{cell(r.total)}</td>
                      </tr>
                    ))}
                    {open[b.bucket] && b.rows.map(r => dataRow(r, { indent: true }))}
                  </React.Fragment>
                ))}
                {dataRow({ label: 'Total of invoice lines', total: model.lineTotal, byMonth: model.monthLines }, { bold: true })}
                {/* The lines of a bill do not always add to its own net. */}
                {dataRow({
                  label: 'Difference to bill net',
                  total: model.billNet - model.lineTotal,
                  byMonth: Object.fromEntries(cols.map(m => [m, (model.monthNet[m] ?? 0) - (model.monthLines[m] ?? 0)])),
                }, { indent: true })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-1.5 border-t border-gray-100 bg-gray-50 text-[11px] text-gray-500">
            Food Cost, Drinks Cost and Packaging only, by invoice date — the same three the P&amp;L COGS line uses.
            By supplier is the net of the bills, so it ties to that line. By product is the net of the invoice
            lines, which comes to a little more, and the difference is shown rather than smoothed away. Products
            are grouped from the invoice wording with pack sizes and article numbers folded away; Non-food is
            everything on a Packaging bill plus crates, empties and the cleaning goods that arrive among the food.
            {' '}The shaded Σ lines summarise the products beneath them and are not an extra cost — they gather one
            vegetable from the dozen spellings it arrives under. Salad bowls and lids are left out of Σ Salat:
            they are packaging, and already counted under Non-food.
          </div>
        </div>
      )}
    </div>
  );
}
