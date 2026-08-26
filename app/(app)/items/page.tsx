'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X, Check, History, Tag, Package } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

// ── Types ─────────────────────────────────────────────────────────────────────
type Counterparty = { id: string; name: string; keywords: string[] };

type Item = {
  id: string;
  name: string;
  keywords: string[];
  primary_supplier_id: string | null;
  secondary_supplier_ids: string[];
  kg_per_unit: number | null;
  created_at: string;
};

type Bill = { id: string; invoice_date: string | null; supplier_name: string };

type BillLine = {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  bill: Bill | null;
};

type FormState = {
  name: string;
  keywordsRaw: string;
  primary_supplier_id: string;
  secondary_supplier_ids: string[];
  kg_per_unit: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);

function fmtDate(d: string | null) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}

// Parse unit size in kg/L from description, e.g. "(3kg)" → 3, "(kg)" → 1
function parseUnitKg(description: string, fallback = 1): number {
  const match = description.match(/\((\d+(?:[.,]\d+)?)\s*(?:kg|l|liter|litre)\)/i);
  if (match) return parseFloat(match[1].replace(',', '.'));
  if (/\(\s*(?:kg|l|liter|litre)\s*\)/i.test(description)) return 1;
  return fallback;
}

function matchLines(item: Item, allLines: BillLine[]): BillLine[] {
  const terms = [item.name, ...item.keywords].filter(Boolean);
  return allLines
    .filter(bl => {
      const desc = (bl.description ?? '').toLowerCase();
      return terms.some(t => t && desc.includes(t.toLowerCase()));
    })
    .sort((a, b) =>
      (b.bill?.invoice_date ?? '').localeCompare(a.bill?.invoice_date ?? '')
    );
}

/** Start of the year-to-date window for the Total YTD column. */
const YTD_START = '2026-01-01';

/**
 * Net spend across the given bill lines from `since` onward.
 *
 * line_total is the net figure on the invoice line, so this sums netto — lines
 * on bills with no invoice_date are skipped rather than assumed to be in range.
 */
function sumNetSince(lines: BillLine[], since: string): number {
  return lines.reduce((sum, l) => {
    const d = l.bill?.invoice_date;
    if (!d || d < since) return sum;
    return sum + (l.line_total ?? 0);
  }, 0);
}

function resolveSupplierName(supplierName: string, counterparties: Counterparty[]): string {
  const cp = counterparties.find(c => {
    const terms = c.keywords.length > 0 ? c.keywords : [c.name];
    return terms.some(t => t && supplierName.toLowerCase().includes(t.toLowerCase()));
  });
  return cp ? cp.name : supplierName;
}

// ── Add/Edit Form ─────────────────────────────────────────────────────────────
function ItemForm({
  initial,
  counterparties,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Item;
  counterparties: Counterparty[];
  onSave: (data: FormState & { keywords: string[] }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<FormState>({
    name:                   initial?.name ?? '',
    keywordsRaw:            (initial?.keywords ?? []).join(', '),
    primary_supplier_id:    initial?.primary_supplier_id ?? '',
    secondary_supplier_ids: initial?.secondary_supplier_ids ?? [],
    kg_per_unit:            initial?.kg_per_unit != null ? String(initial.kg_per_unit) : '',
  });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  const addSecondary = (id: string) => {
    if (!id || form.secondary_supplier_ids.includes(id)) return;
    set('secondary_supplier_ids', [...form.secondary_supplier_ids, id]);
  };

  const removeSecondary = (id: string) =>
    set('secondary_supplier_ids', form.secondary_supplier_ids.filter(x => x !== id));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const keywords = form.keywordsRaw.split(',').map(k => k.trim()).filter(Boolean);
    onSave({ ...form, keywords });
  };

  const availableSecondary = counterparties.filter(
    cp => cp.id !== form.primary_supplier_id && !form.secondary_supplier_ids.includes(cp.id)
  );

  return (
    <form onSubmit={handleSubmit} className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Name *</label>
          <input required value={form.name} onChange={e => set('name', e.target.value)}
            placeholder="e.g. Saure Sahne"
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">
            Keywords <span className="font-normal text-gray-400">(comma-separated — for auto-matching bill lines)</span>
          </label>
          <input value={form.keywordsRaw} onChange={e => set('keywordsRaw', e.target.value)}
            placeholder="saure sahne, sour cream, ..."
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Primary Supplier</label>
          <select value={form.primary_supplier_id}
            onChange={e => set('primary_supplier_id', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
            <option value="">— None —</option>
            {counterparties.map(cp => <option key={cp.id} value={cp.id}>{cp.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">
            kg / L per purchased unit{' '}
            <span className="font-normal text-gray-400">(blank = 1 : 1)</span>
          </label>
          <input type="number" step="0.001" min="0" value={form.kg_per_unit}
            onChange={e => set('kg_per_unit', e.target.value)}
            placeholder="e.g. 10 for a 10 kg container"
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-gray-600 block mb-1">Secondary Suppliers</label>
        <div className="flex items-center gap-2 flex-wrap">
          {form.secondary_supplier_ids.map(id => {
            const cp = counterparties.find(c => c.id === id);
            return cp ? (
              <span key={id} className="inline-flex items-center gap-1 bg-gray-200 text-gray-700 text-xs px-2 py-0.5 rounded-full">
                {cp.name}
                <button type="button" onClick={() => removeSecondary(id)} className="hover:text-red-500 transition-colors">
                  <X size={10} />
                </button>
              </span>
            ) : null;
          })}
          {availableSecondary.length > 0 && (
            <select value="" onChange={e => addSecondary(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="">+ Add supplier…</option>
              {availableSecondary.map(cp => <option key={cp.id} value={cp.id}>{cp.name}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button type="submit" disabled={saving}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-[#1B5E20] text-white text-sm font-medium rounded-lg hover:bg-[#2E7D32] disabled:opacity-60 transition-colors">
          <Check size={14} /> {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
          <X size={14} /> Cancel
        </button>
      </div>
    </form>
  );
}

// ── Purchase History Modal ────────────────────────────────────────────────────
function PurchaseHistoryModal({
  item,
  lines,
  counterparties,
  onClose,
}: {
  item: Item;
  lines: BillLine[];
  counterparties: Counterparty[];
  onClose: () => void;
}) {
  const kgPerUnit = item.kg_per_unit ?? 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl mx-4 flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900">Purchase History — {item.name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {lines.length} purchase{lines.length !== 1 ? 's' : ''}
              {item.kg_per_unit ? ` · 1 unit = ${item.kg_per_unit} kg / L` : ' · set kg/L per unit to enable accurate price/kg'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto max-h-[340px]">
          {lines.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">
              No purchases found yet — add keywords if the item name doesn&apos;t match bill lines
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">Date</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Supplier</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Description</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Qty</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Unit</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">Price / Unit</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">Price / KG or L</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">Total (net)</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(line => {
                  const bill = line.bill ?? null;
                  const unitKg = parseUnitKg(line.description, kgPerUnit);
                  const pricePerKg = line.unit_price / unitKg;
                  return (
                    <tr key={line.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap font-mono text-xs">
                        {fmtDate(bill?.invoice_date ?? null)}
                      </td>
                      <td className="px-4 py-2.5 text-gray-800 text-sm whitespace-nowrap">
                        {bill?.supplier_name
                          ? resolveSupplierName(bill.supplier_name, counterparties)
                          : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs max-w-[220px] truncate" title={line.description}>
                        {line.description}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums">{line.quantity}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500 text-xs whitespace-nowrap">
                        {unitKg === 1 ? '1 kg' : `${unitKg} kg`}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-900 font-medium tabular-nums">{fmt(line.unit_price)}</td>
                      <td className="px-4 py-2.5 text-right text-[#1B5E20] font-semibold tabular-nums">
                        {fmt(pricePerKg)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-900 tabular-nums">{fmt(line.line_total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Price / KG or L chart */}
        {lines.length > 0 && (() => {
          const chartData = [...lines]
            .filter(l => l.bill?.invoice_date)
            .sort((a, b) => new Date(a.bill!.invoice_date!).getTime() - new Date(b.bill!.invoice_date!).getTime())
            .map(l => ({
              date: fmtDate(l.bill!.invoice_date!),
              price: parseFloat((l.unit_price / parseUnitKg(l.description, kgPerUnit)).toFixed(2)),
            }));
          return (
            <div className="border-t border-gray-100 px-4 pt-4 pb-3">
              <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Price / KG or L over time</p>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#9ca3af' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={v => `${v} €`}
                    width={48}
                  />
                  <Tooltip
                    formatter={(v) => [typeof v === 'number' ? `${v.toFixed(2)} €` : v, 'Price / KG or L']}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="price"
                    stroke="#1B5E20"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#1B5E20', strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ItemsPage() {
  const qc = useQueryClient();
  const [adding, setAdding]           = useState(false);
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [historyItem, setHistoryItem] = useState<Item | null>(null);

  const { data: rawItems, isLoading, isError } = useQuery<Item[]>({
    queryKey: ['items'],
    queryFn: async () => {
      const r = await fetch('/api/items');
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 30_000,
  });
  const items: Item[] = Array.isArray(rawItems)
    ? rawItems.map(item => ({
        ...item,
        keywords:               Array.isArray(item.keywords)               ? item.keywords               : [],
        secondary_supplier_ids: Array.isArray(item.secondary_supplier_ids) ? item.secondary_supplier_ids : [],
      }))
    : [];

  const { data: rawCounterparties } = useQuery<Counterparty[]>({
    queryKey: ['counterparties'],
    queryFn: () => fetch('/api/counterparties').then(r => r.json()),
    staleTime: 60_000,
  });
  const counterparties: Counterparty[] = Array.isArray(rawCounterparties)
    ? rawCounterparties.map(cp => ({ ...cp, keywords: Array.isArray(cp.keywords) ? cp.keywords : [] }))
    : [];

  const { data: rawBillLines } = useQuery<BillLine[]>({
    queryKey: ['bill-lines-all'],
    queryFn: async () => {
      const r = await fetch('/api/items/bill-lines');
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 60_000,
  });
  const billLines: BillLine[] = Array.isArray(rawBillLines) ? rawBillLines : [];

  const buildPayload = (data: FormState & { keywords: string[] }) => ({
    name:                   data.name,
    keywords:               data.keywords,
    primary_supplier_id:    data.primary_supplier_id || null,
    secondary_supplier_ids: data.secondary_supplier_ids,
    kg_per_unit:            data.kg_per_unit !== '' ? Number(data.kg_per_unit) : null,
  });

  const createMut = useMutation({
    mutationFn: (body: object) => fetch('/api/items', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['items'] }); setAdding(false); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => fetch(`/api/items/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['items'] }); setEditingId(null); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => fetch(`/api/items/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  });

  const historyLines = useMemo(
    () => (historyItem ? matchLines(historyItem, billLines) : []),
    [historyItem, billLines]
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Items</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Track purchased items and auto-match prices from bills.
          </p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#1B5E20] text-white text-sm font-medium rounded-lg hover:bg-[#2E7D32] transition-colors">
            <Plus size={16} /> Add Item
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-4">
          <ItemForm
            counterparties={counterparties}
            onSave={data => createMut.mutate(buildPayload(data))}
            onCancel={() => setAdding(false)}
            saving={createMut.isPending}
          />
        </div>
      )}

      {isError ? (
        <div className="py-12 text-center">
          <div className="text-red-500 font-medium text-sm">Could not load items</div>
          <div className="text-gray-400 text-xs mt-1">
            Run the migration in Supabase: <code>supabase/items_migration.sql</code>
          </div>
        </div>
      ) : isLoading ? (
        <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
      ) : items.length === 0 && !adding ? (
        <div className="py-16 text-center">
          <Package size={40} className="mx-auto text-gray-300 mb-3" />
          <div className="text-gray-500 font-medium">No items yet</div>
          <div className="text-gray-400 text-sm mt-1">Add your first item to start tracking prices.</div>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1000px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Primary Supplier</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Secondary Suppliers</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap"
                    title={`Net spend on this item since ${YTD_START.split('-').reverse().join('.')}`}>
                    Total YTD
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Price / Unit</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Price / kg·L</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">History</th>
                  <th className="px-4 py-2.5 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map(item => {
                  if (editingId === item.id) {
                    return (
                      <tr key={item.id} className="bg-indigo-50/40">
                        <td colSpan={8} className="px-4 py-4">
                          <ItemForm
                            initial={item}
                            counterparties={counterparties}
                            onSave={data => updateMut.mutate({ id: item.id, body: buildPayload(data) })}
                            onCancel={() => setEditingId(null)}
                            saving={updateMut.isPending}
                          />
                        </td>
                      </tr>
                    );
                  }

                  const matched      = matchLines(item, billLines);
                  const latest       = matched[0] ?? null;
                  const totalYtd     = sumNetSince(matched, YTD_START);
                  const kgPerUnit    = item.kg_per_unit ?? 1;
                  const pricePerUnit = latest?.unit_price ?? null;
                  const pricePerKg   = pricePerUnit != null ? pricePerUnit / kgPerUnit : null;
                  const primaryCp    = counterparties.find(c => c.id === item.primary_supplier_id);
                  const secondaryCps = item.secondary_supplier_ids
                    .map(id => counterparties.find(c => c.id === id))
                    .filter((c): c is Counterparty => Boolean(c));

                  return (
                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-gray-900">{item.name}</div>
                        {item.keywords.length > 0 && (
                          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                            <Tag size={9} className="text-gray-400 flex-shrink-0" />
                            {item.keywords.map(kw => (
                              <span key={kw} className="text-[10px] bg-gray-100 text-gray-500 px-1 rounded">{kw}</span>
                            ))}
                          </div>
                        )}
                        {item.kg_per_unit ? (
                          <div className="text-[10px] text-gray-400 mt-0.5">1 unit = {item.kg_per_unit} kg / L</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        {primaryCp ? (
                          <span className="inline-block px-2 py-0.5 bg-green-50 text-green-800 text-xs rounded-full border border-green-200">
                            {primaryCp.name}
                          </span>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {secondaryCps.length > 0
                            ? secondaryCps.map(cp => (
                              <span key={cp.id} className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                                {cp.name}
                              </span>
                            ))
                            : <span className="text-gray-300 text-xs">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {totalYtd > 0
                          ? <span className="font-bold text-gray-900">{fmt(totalYtd)}</span>
                          : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {pricePerUnit != null
                          ? <span className="font-semibold text-gray-900">{fmt(pricePerUnit)}</span>
                          : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {pricePerKg != null
                          ? <span className="font-semibold text-[#1B5E20]">{fmt(pricePerKg)}</span>
                          : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button onClick={() => setHistoryItem(item)}
                          title="View purchase history"
                          className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 transition-colors">
                          <History size={15} />
                          <span className="text-[10px] text-gray-400">{matched.length}</span>
                        </button>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          <button onClick={() => setEditingId(item.id)}
                            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors">
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => {
                              if (!confirm(`Delete "${item.name}"?`)) return;
                              deleteMut.mutate(item.id);
                            }}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {historyItem && (
        <PurchaseHistoryModal
          item={historyItem}
          lines={historyLines}
          counterparties={counterparties}
          onClose={() => setHistoryItem(null)}
        />
      )}
    </div>
  );
}
