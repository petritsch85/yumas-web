'use client';

import dynamic from 'next/dynamic';
import { useState, useCallback } from 'react';
import { Plus, Trash2, FileDown } from 'lucide-react';
import type { BillData, LineItem } from '@/components/bills/BillDocument';
import { useT } from '@/lib/i18n';

// Must be loaded dynamically (no SSR) due to @react-pdf/renderer
const BillDocument = dynamic(
  () => import('@/components/bills/BillDocument').then((m) => m.BillDocument),
  { ssr: false }
);

const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
};

const DEFAULT_INTRO_MONTHLY = 'Wir bedanken uns für Ihren Auftrag und stellen Ihnen für die Bestellungen wie folgt eine Rechnung:';
const DEFAULT_INTRO_DINNER  = 'Wir bedanken uns für Ihren Auftrag und stellen Ihnen für das Abendessen wie folgt eine Rechnung:';

export default function NewBillPage() {
  const { t } = useT();
  const [type, setType]             = useState<'monthly' | 'dinner'>('dinner');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [date, setDate]             = useState(today());
  const [company, setCompany]       = useState('');
  const [extra, setExtra]           = useState('');
  const [contact, setContact]       = useState('');
  const [street, setStreet]         = useState('');
  const [postcode, setPostcode]     = useState('');
  const [city, setCity]             = useState('');
  const [poNumber, setPoNumber]     = useState('');
  const [att, setAtt]               = useState('');
  const [introText, setIntroText]   = useState(DEFAULT_INTRO_DINNER);
  // Type B (dinner)
  const [essenNetto, setEssenNetto]         = useState('');
  const [getraenkeNetto, setGetraenkeNetto] = useState('');
  const [trinkgeld, setTrinkgeld]           = useState('');
  // Type A (monthly)
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { qty: 1, item: '', unitPrice: 0 },
  ]);

  const [generating, setGenerating] = useState(false);

  const handleTypeChange = (t: 'monthly' | 'dinner') => {
    setType(t);
    setIntroText(t === 'monthly' ? DEFAULT_INTRO_MONTHLY : DEFAULT_INTRO_DINNER);
  };

  const addLineItem = () =>
    setLineItems((prev) => [...prev, { qty: 1, item: '', unitPrice: 0 }]);

  const updateLineItem = (i: number, field: keyof LineItem, value: string) => {
    setLineItems((prev) =>
      prev.map((row, idx) =>
        idx === i ? { ...row, [field]: field === 'item' ? value : parseFloat(value) || 0 } : row
      )
    );
  };

  const removeLineItem = (i: number) =>
    setLineItems((prev) => prev.filter((_, idx) => idx !== i));

  const buildData = useCallback((): BillData => ({
    invoiceNumber,
    date,
    type,
    recipient: { company, extra, contact, street, postcode, city, poNumber, att },
    introText,
    lineItems : type === 'monthly' ? lineItems : undefined,
    essenNetto    : type === 'dinner' ? parseFloat(essenNetto)     || 0 : undefined,
    getraenkeNetto: type === 'dinner' ? parseFloat(getraenkeNetto) || 0 : undefined,
    trinkgeld     : type === 'dinner' ? parseFloat(trinkgeld)      || 0 : undefined,
  }), [invoiceNumber, date, type, company, extra, contact, street, postcode, city,
       poNumber, att, introText, lineItems, essenNetto, getraenkeNetto, trinkgeld]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { pdf } = await import('@react-pdf/renderer');
      const data = buildData();
      const blob = await pdf(<BillDocument data={data} />).toBlob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${invoiceNumber || 'Rechnung'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setGenerating(false);
    }
  };

  // Live totals for preview
  const essenN     = parseFloat(essenNetto)     || 0;
  const getraenkeN = parseFloat(getraenkeNetto) || 0;
  const trinkgeldN = parseFloat(trinkgeld)      || 0;
  const linesTotal = lineItems.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const netto      = type === 'monthly' ? linesTotal : essenN + getraenkeN;
  const mwst7      = type === 'monthly' ? netto * 0.07 : essenN * 0.07;
  const mwst19     = type === 'dinner'  ? getraenkeN * 0.19 : 0;
  const brutto     = netto + mwst7 + mwst19;
  const total      = brutto + (type === 'dinner' ? trinkgeldN : 0);

  const fmt = (n: number) =>
    n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]';
  const labelCls = 'block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1';

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('bills.newBill')}</h1>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-2 bg-[#1B5E20] text-white px-5 py-2.5 rounded-lg text-sm font-bold hover:bg-[#2E7D32] transition-colors disabled:opacity-50"
        >
          <FileDown size={16} />
          {generating ? 'Generating…' : 'Generate PDF'}
        </button>
      </div>

      <div className="space-y-5">

        {/* ── Bill type ──────────────────────────────────────────── */}
        <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5">
          <p className={labelCls}>Bill Type</p>
          <div className="flex gap-3">
            {(['dinner', 'monthly'] as const).map((t) => (
              <button
                key={t}
                onClick={() => handleTypeChange(t)}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                  type === t
                    ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-[#1B5E20]'
                }`}
              >
                {t === 'dinner' ? 'Dinner / Event' : 'Monthly Orders'}
              </button>
            ))}
          </div>
        </div>

        {/* ── Invoice details ────────────────────────────────────── */}
        <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5">
          <p className="text-sm font-bold text-gray-700 mb-4">Invoice Details</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Invoice Number</label>
              <input className={inputCls} placeholder="e.g. 75-26"
                value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Date (DD.MM.YYYY)</label>
              <input className={inputCls} placeholder={today()}
                value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
        </div>

        {/* ── Recipient ──────────────────────────────────────────── */}
        <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5">
          <p className="text-sm font-bold text-gray-700 mb-4">Recipient</p>
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Company Name *</label>
              <input className={inputCls} placeholder="e.g. KIA Europe GmbH"
                value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Extra line (e.g. branch name — optional)</label>
              <input className={inputCls} placeholder="e.g. Zweigniederlassung Deutschland"
                value={extra} onChange={(e) => setExtra(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Contact Name (optional)</label>
              <input className={inputCls} placeholder="e.g. Bimal Sahoo"
                value={contact} onChange={(e) => setContact(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Street Address *</label>
              <input className={inputCls} placeholder="e.g. Theodor-Heuss-Allee 11"
                value={street} onChange={(e) => setStreet(e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Postcode *</label>
                <input className={inputCls} placeholder="60486"
                  value={postcode} onChange={(e) => setPostcode(e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>City *</label>
                <input className={inputCls} placeholder="Frankfurt am Main"
                  value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>PO Number (optional)</label>
                <input className={inputCls} placeholder="e.g. 2700061132"
                  value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Att: (optional)</label>
                <input className={inputCls} placeholder="e.g. Zara Hajiali"
                  value={att} onChange={(e) => setAtt(e.target.value)} />
              </div>
            </div>
          </div>
        </div>

        {/* ── Intro text ─────────────────────────────────────────── */}
        <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5">
          <label className={labelCls}>Intro Text</label>
          <textarea
            className={`${inputCls} resize-none`}
            rows={3}
            value={introText}
            onChange={(e) => setIntroText(e.target.value)}
          />
        </div>

        {/* ── Type A: Line items ─────────────────────────────────── */}
        {type === 'monthly' && (
          <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-bold text-gray-700">Line Items</p>
              <button onClick={addLineItem}
                className="flex items-center gap-1.5 text-sm text-[#1B5E20] font-medium hover:underline">
                <Plus size={14} /> Add row
              </button>
            </div>
            {/* Header */}
            <div className="grid grid-cols-[50px_1fr_120px_90px_32px] gap-2 mb-2">
              {['Qty','Item','Unit Price €','Total',''].map((h) => (
                <p key={h} className="text-xs font-semibold text-gray-400 uppercase">{h}</p>
              ))}
            </div>
            {lineItems.map((row, i) => (
              <div key={i} className="grid grid-cols-[50px_1fr_120px_90px_32px] gap-2 mb-2 items-center">
                <input type="number" min="1" className={inputCls} value={row.qty}
                  onChange={(e) => updateLineItem(i, 'qty', e.target.value)} />
                <input type="text" className={inputCls} placeholder="e.g. Chicken Burrito"
                  value={row.item} onChange={(e) => updateLineItem(i, 'item', e.target.value)} />
                <input type="number" step="0.01" className={inputCls} placeholder="12.62"
                  value={row.unitPrice || ''} onChange={(e) => updateLineItem(i, 'unitPrice', e.target.value)} />
                <div className={`${inputCls} bg-gray-50 text-right text-gray-700`}>
                  {fmt(row.qty * row.unitPrice)}
                </div>
                <button onClick={() => removeLineItem(i)} className="text-gray-300 hover:text-red-400">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Type B: Dinner amounts ─────────────────────────────── */}
        {type === 'dinner' && (
          <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5">
            <p className="text-sm font-bold text-gray-700 mb-4">Amounts</p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Essen Netto (€)</label>
                <input type="number" step="0.01" className={inputCls} placeholder="0.00"
                  value={essenNetto} onChange={(e) => setEssenNetto(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Getränke Netto (€)</label>
                <input type="number" step="0.01" className={inputCls} placeholder="0.00"
                  value={getraenkeNetto} onChange={(e) => setGetraenkeNetto(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Trinkgeld (€) — optional</label>
                <input type="number" step="0.01" className={inputCls} placeholder="0.00"
                  value={trinkgeld} onChange={(e) => setTrinkgeld(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {/* ── Live totals preview ────────────────────────────────── */}
        <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-5">
          <p className="text-sm font-bold text-gray-700 mb-3">Totals Preview</p>
          <div className="space-y-1 text-sm max-w-xs ml-auto">
            {type === 'dinner' && (
              <>
                <div className="flex justify-between text-gray-600">
                  <span>Gesamt Essen netto</span><span>{fmt(essenN)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Gesamt Getränke netto</span><span>{fmt(getraenkeN)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between text-gray-600">
              <span>Gesamt Netto</span><span>{fmt(netto)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Mwst (7%)</span><span>{fmt(mwst7)}</span>
            </div>
            {type === 'dinner' && (
              <div className="flex justify-between text-gray-600">
                <span>Mwst (19%)</span><span>{fmt(mwst19)}</span>
              </div>
            )}
            <div className="border-t border-gray-100 my-1" />
            <div className="flex justify-between text-gray-600">
              <span>Gesamt Brutto</span><span>{fmt(brutto)}</span>
            </div>
            {type === 'dinner' && trinkgeldN > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Trinkgeld</span><span>{fmt(trinkgeldN)}</span>
              </div>
            )}
            <div className="border-t border-gray-200 my-1" />
            <div className="flex justify-between font-bold text-gray-900">
              <span>Gesamtbetrag</span><span>{fmt(total)}</span>
            </div>
          </div>
        </div>

        {/* Generate button (bottom) */}
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="w-full flex items-center justify-center gap-2 bg-[#1B5E20] text-white py-3 rounded-lg text-sm font-bold hover:bg-[#2E7D32] transition-colors disabled:opacity-50"
        >
          <FileDown size={16} />
          {generating ? 'Generating PDF…' : 'Generate & Download PDF'}
        </button>

      </div>
    </div>
  );
}
