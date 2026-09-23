'use client';

/**
 * Umsatzsteuervoranmeldung — the monthly VAT position, computed.
 *
 * Read-only on purpose. The figure here is what the documents say the return
 * should be; it is meant to be run beside what the Steuerberater files, month
 * after month, until the two agree without exception. Every number opens onto
 * the rows behind it, because a number you cannot take apart is not evidence.
 *
 * The return belongs to the company, not to a restaurant, so every location is
 * summed. A single location can still be shown, to find where a difference is.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { computeUstva } from '@/lib/ustva';
import type {
  UstvaShift, UstvaWebshop, UstvaDeliveryDay, UstvaOutgoingBill, UstvaBill, UstvaFeeInvoice,
} from '@/lib/ustva';
import { MapPin, CalendarDays, AlertTriangle, Info, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

const eur = (n: number) =>
  n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const de = (iso: string) => iso.split('-').reverse().join('.');

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export default function UstvaPage() {
  const today = new Date();
  const [year,  setYear]  = useState(today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() === 0 ? 12 : today.getMonth()); // the month just closed
  const [locationId, setLocationId] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to   = `${year}-${String(month).padStart(2, '0')}-${String(lastDay(year, month)).padStart(2, '0')}`;

  const { data: locations = [] } = useQuery({
    queryKey: ['locations-ustva'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('id, name, type').eq('is_active', true).order('name');
      return ((data ?? []) as { id: string; name: string; type: string }[])
        .filter(l => l.type === 'restaurant').map(({ id, name }) => ({ id, name }));
    },
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['ustva', from, to, locationId],
    queryFn: async () => {
      const loc = <T,>(q: T): T => (locationId ? (q as { eq: (a: string, b: string) => T }).eq('location_id', locationId) : q);

      const [shifts, webshop, wolt, lieferando, outgoing, bills, woltP, liefP, nexi] = await Promise.all([
        loc(supabase.from('shift_reports')
          .select('report_date,location_id,gross_food,gross_beverages,gross_total,vat_total')
          .gte('report_date', from).lte('report_date', to)),
        loc(supabase.from('webshop_orders')
          .select('sale_date,net_cents,vat_cents').eq('counts', true)
          .gte('sale_date', from).lte('sale_date', to)),
        loc(supabase.from('wolt_shift_sales')
          .select('sale_date,net_sales,refund_est').gte('sale_date', from).lte('sale_date', to)),
        loc(supabase.from('lieferando_shift_sales')
          .select('sale_date,net_sales,refund_est,stamp_card_est').gte('sale_date', from).lte('sale_date', to)),
        supabase.from('outgoing_bills')
          .select('id,invoice_number,invoice_date,customer_name,net_food,vat_7,net_drinks,vat_19,issuing_location,status')
          .gte('invoice_date', from).lte('invoice_date', to),
        supabase.from('bills')
          .select('id,supplier_name,invoice_number,invoice_date,net_amount,vat_amount,gross_amount,status,category')
          .gte('invoice_date', from).lte('invoice_date', to),
        loc(supabase.from('wolt_periods')
          .select('invoice_number,invoice_date,commission,advertising')
          .gte('invoice_date', from).lte('invoice_date', to)),
        loc(supabase.from('lieferando_periods')
          .select('invoice_number,invoice_date,fees_net,fees_vat')
          .gte('invoice_date', from).lte('invoice_date', to)),
        supabase.from('nexi_statements')
          .select('invoice_number,invoice_date,fees_net,fees_vat')
          .gte('invoice_date', from).lte('invoice_date', to),
      ]);

      const locName = locationId ? locations.find(l => l.id === locationId)?.name : null;

      /* Wolt states no VAT on its own fee invoice here, so 19% is applied to
         the commission and advertising it charged. Lieferando and Nexi state
         theirs, and are taken as stated. */
      const feeInvoices: UstvaFeeInvoice[] = [
        ...((woltP.data ?? []) as { invoice_number: string; invoice_date: string; commission: number; advertising: number }[])
          .map(p => {
            const net = Number(p.commission ?? 0) + Number(p.advertising ?? 0);
            return { source: 'Wolt', reference: p.invoice_number, invoice_date: p.invoice_date, net, vat: Math.round(net * 0.19 * 100) / 100 };
          }),
        ...((liefP.data ?? []) as { invoice_number: string; invoice_date: string; fees_net: number; fees_vat: number }[])
          .map(p => ({ source: 'Lieferando', reference: p.invoice_number, invoice_date: p.invoice_date, net: Number(p.fees_net), vat: Number(p.fees_vat) })),
        ...((nexi.data ?? []) as { invoice_number: string; invoice_date: string; fees_net: number; fees_vat: number }[])
          .map(p => ({ source: 'Nexi', reference: p.invoice_number, invoice_date: p.invoice_date, net: Number(p.fees_net), vat: Number(p.fees_vat) })),
      ];

      const outRows = ((outgoing.data ?? []) as (UstvaOutgoingBill & { issuing_location: string | null; status: string })[])
        .filter(b => b.status !== 'storno' && (!locName || b.issuing_location === locName));

      return {
        result: computeUstva({
          from, to,
          shifts:     (shifts.data ?? []) as UstvaShift[],
          webshop:    (webshop.data ?? []) as UstvaWebshop[],
          wolt:       (wolt.data ?? []) as UstvaDeliveryDay[],
          lieferando: (lieferando.data ?? []) as UstvaDeliveryDay[],
          outgoing:   outRows,
          bills:      (bills.data ?? []) as UstvaBill[],
          feeInvoices,
        }),
        bills:   (bills.data ?? []) as UstvaBill[],
        outRows,
        feeInvoices,
        shiftCount: (shifts.data ?? []).length,
      };
    },
    enabled: locations.length > 0 || !locationId,
  });

  const r = data?.result;
  const years = useMemo(() => {
    const ys: number[] = [];
    for (let y = today.getFullYear(); y >= 2025; y--) ys.push(y);
    return ys;
  }, [today]);

  /** One Kennzahl, as the form numbers it. */
  const kz = (code: string, label: string, base: number | null, tax: number, strong = false) => (
    <div className={`flex items-center gap-4 px-4 py-3 border-b border-gray-100 ${strong ? 'bg-gray-50' : ''}`}>
      <span className="w-10 text-xs font-bold text-gray-400 tabular-nums">{code}</span>
      <span className={`flex-1 text-sm ${strong ? 'font-bold text-gray-900' : 'text-gray-700'}`}>{label}</span>
      <span className="w-36 text-right text-sm tabular-nums text-gray-500">{base != null ? eur(base) : ''}</span>
      <span className={`w-36 text-right text-sm tabular-nums ${strong ? 'font-bold text-gray-900' : 'text-gray-800'}`}>{eur(tax)}</span>
    </div>
  );

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900">Umsatzsteuervoranmeldung</h1>
      <p className="text-sm text-gray-500 mb-5">
        Computed from the sales records and invoices · to be checked against what is filed, not filed from
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <CalendarDays size={13} className="text-gray-400" />
        <select value={month} onChange={e => setMonth(Number(e.target.value))}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 cursor-pointer">
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 cursor-pointer">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        <span className="w-4" />
        <MapPin size={13} className="text-gray-400" />
        <select value={locationId} onChange={e => setLocationId(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 cursor-pointer">
          <option value="">Yumas GmbH — every location</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name} only</option>)}
        </select>
        {locationId && (
          <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
            One location — the return itself covers the whole company
          </span>
        )}
      </div>

      {isLoading && <div className="py-16 text-center text-gray-400"><Loader2 size={22} className="mx-auto animate-spin" /></div>}
      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{(error as Error).message}</div>}

      {r && (
        <>
          {/* ── The form ── */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="flex items-center gap-4 px-4 py-2 bg-gray-900 text-white text-[11px] font-bold uppercase tracking-wider">
              <span className="w-10">Kz</span>
              <span className="flex-1">{de(from)} – {de(to)}</span>
              <span className="w-36 text-right">Bemessungsgrundlage</span>
              <span className="w-36 text-right">Steuer</span>
            </div>

            {kz('81', 'Umsätze zum Steuersatz von 19 %', r.net19, r.vat19)}
            {kz('86', 'Umsätze zum Steuersatz von 7 %',  r.net7,  r.vat7)}
            {kz('',   'Umsatzsteuer', null, Math.round((r.vat19 + r.vat7) * 100) / 100, true)}
            {kz('66', 'Vorsteuerbeträge aus Rechnungen von anderen Unternehmern', r.inputNet, -r.inputVat)}
            {kz('83', r.payable >= 0 ? 'Verbleibende Umsatzsteuer-Vorauszahlung' : 'Verbleibender Überschuss', null, r.payable, true)}
          </div>

          {/* ── What stands behind each figure ── */}
          <h2 className="mt-8 mb-2 text-sm font-bold text-gray-900">Umsätze</h2>
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {r.revenueLines.length === 0 && <p className="px-4 py-6 text-sm text-gray-400 text-center">No sales recorded in this period.</p>}
            {r.revenueLines.map(l => (
              <div key={l.key} className="flex items-center gap-4 px-4 py-2.5 border-b border-gray-50 last:border-0">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${l.rate === 19 ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                  {l.rate} %
                </span>
                <span className="flex-1 text-sm text-gray-700">
                  {l.label}
                  {l.note && <span className="block text-[11px] text-gray-400">{l.note}</span>}
                </span>
                <span className="w-16 text-right text-xs text-gray-400 tabular-nums">{l.count}</span>
                <span className="w-32 text-right text-sm tabular-nums text-gray-800">{eur(l.net)}</span>
                <span className="w-28 text-right text-sm tabular-nums text-gray-500">{eur(l.vat)}</span>
              </div>
            ))}
          </div>

          <h2 className="mt-8 mb-2 text-sm font-bold text-gray-900">Vorsteuer</h2>
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {r.inputLines.length === 0 && <p className="px-4 py-6 text-sm text-gray-400 text-center">No invoices dated in this period.</p>}
            {r.inputLines.map(l => {
              const isBills = l.key === 'bills-in';
              const expanded = open === l.key;
              return (
                <div key={l.key} className="border-b border-gray-50 last:border-0">
                  <button
                    onClick={() => setOpen(expanded ? null : l.key)}
                    className="w-full flex items-center gap-4 px-4 py-2.5 hover:bg-gray-50 transition-colors text-left">
                    {expanded ? <ChevronDown size={13} className="text-gray-400" /> : <ChevronRight size={13} className="text-gray-400" />}
                    <span className="flex-1 text-sm text-gray-700">{l.label}</span>
                    <span className="w-16 text-right text-xs text-gray-400 tabular-nums">{l.count}</span>
                    <span className="w-32 text-right text-sm tabular-nums text-gray-800">{eur(l.net)}</span>
                    <span className="w-28 text-right text-sm tabular-nums text-gray-500">{eur(l.vat)}</span>
                  </button>
                  {expanded && (
                    <div className="bg-gray-50/60 px-4 py-2 max-h-80 overflow-y-auto">
                      <table className="w-full text-xs">
                        <tbody>
                          {isBills
                            ? (data?.bills ?? []).filter(b => b.status === 'approved').map(b => (
                              <tr key={b.id} className="border-b border-gray-100 last:border-0">
                                <td className="py-1 pr-3 text-gray-500 whitespace-nowrap">{de(b.invoice_date)}</td>
                                <td className="py-1 pr-3 text-gray-800">{b.supplier_name}</td>
                                <td className="py-1 pr-3 text-gray-400">{b.invoice_number ?? '—'}</td>
                                <td className="py-1 pr-3 text-right tabular-nums text-gray-700">{eur(Number(b.net_amount))}</td>
                                <td className="py-1 text-right tabular-nums text-gray-500">{eur(Number(b.vat_amount))}</td>
                              </tr>
                            ))
                            : (data?.feeInvoices ?? []).filter(f => `fee-${f.source}` === l.key).map(f => (
                              <tr key={f.reference} className="border-b border-gray-100 last:border-0">
                                <td className="py-1 pr-3 text-gray-500 whitespace-nowrap">{de(f.invoice_date)}</td>
                                <td className="py-1 pr-3 text-gray-800">{f.source}</td>
                                <td className="py-1 pr-3 text-gray-400 break-all">{f.reference}</td>
                                <td className="py-1 pr-3 text-right tabular-nums text-gray-700">{eur(f.net)}</td>
                                <td className="py-1 text-right tabular-nums text-gray-500">{eur(f.vat)}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── What to look at before trusting it ── */}
          {r.checks.length > 0 && (
            <>
              <h2 className="mt-8 mb-2 text-sm font-bold text-gray-900">Before this could be filed</h2>
              <div className="space-y-2">
                {r.checks.map((c, i) => (
                  <div key={i} className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
                    c.level === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-gray-50 border-gray-200 text-gray-600'
                  }`}>
                    {c.level === 'warn' ? <AlertTriangle size={14} className="flex-shrink-0 mt-0.5 text-amber-500" />
                                        : <Info size={14} className="flex-shrink-0 mt-0.5 text-gray-400" />}
                    <span>{c.text}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <p className="mt-6 mb-10 text-xs text-gray-400">
            Revenue is taken from the sales records by the day of the sale and input VAT from the invoices by
            their invoice date — the Soll-Versteuerung the company is on. Card settlements and platform payouts
            are deliberately ignored: they are the same takings arriving later, net of a fee, and reading them
            would count the revenue twice and lose the fee’s input VAT. A delivery platform’s commission is
            therefore input VAT here, not a deduction from sales, which is where this figure parts company with
            the P&amp;L.
          </p>
        </>
      )}
    </div>
  );
}
