'use client';

/**
 * DATEV — the month as a posting batch, ready for the Steuerberater.
 *
 * Three things live here, in the order they have to be done:
 *
 *  1. the client's settings, which decide every default account;
 *  2. the mapping — which account each supplier and each category posts to.
 *     This is the Vorkontierung, agreed once and then automatic;
 *  3. the export itself, with what could not be posted named above it.
 *
 * Nothing is sent anywhere. The file is downloaded and handed over, and the
 * first one should be a test import: a batch that DATEV rejects says little
 * about why, so it is better to find out on an empty period.
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  buildBuchungsstapel, buchungsstapelFilename, toWindows1252, CHART_DEFAULTS,
} from '@/lib/datev-extf';
import type { DatevSettings, Skr } from '@/lib/datev-extf';
import { buildPostings } from '@/lib/datev-postings';
import {
  CalendarDays, Download, AlertTriangle, Settings2, Loader2, Check, BookOpen, FileArchive,
} from 'lucide-react';

const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const eur = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const de  = (iso: string) => iso.split('-').reverse().join('.');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

type AccountRow = {
  scope: 'counterparty' | 'category'; ref: string;
  account: string | null; creditor_account: string | null;
  bu_key: string | null; cost_centre: string | null;
};

export default function DatevPage() {
  const qc = useQueryClient();
  const today = new Date();
  const [year,  setYear]  = useState(today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() === 0 ? 12 : today.getMonth());
  const [tab, setTab] = useState<'export' | 'mapping' | 'settings'>('export');
  const [saving, setSaving] = useState(false);
  const [belege, setBelege] = useState<{ busy: boolean; msg: string | null }>({ busy: false, msg: null });

  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to   = `${year}-${String(month).padStart(2, '0')}-${String(lastDay(year, month)).padStart(2, '0')}`;

  /* ── Settings ── */
  const { data: settingsRow } = useQuery({
    queryKey: ['datev-settings'],
    queryFn: async () => {
      const { data } = await supabase.from('datev_settings').select('*').eq('id', 1).maybeSingle();
      return data as Record<string, string | number | null> | null;
    },
  });
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const settings: DatevSettings = useMemo(() => {
    const r = draft ?? (settingsRow as Record<string, string> | null) ?? {};
    const chart = ((r.chart as Skr) ?? 'SKR03') as Skr;
    const d = CHART_DEFAULTS[chart];
    return {
      consultantNumber: String(r.consultant_number ?? ''),
      clientNumber:     String(r.client_number ?? ''),
      chart,
      accountLength:    Number(r.account_length ?? 4),
      fiscalYearStart:  String(r.fiscal_year_start ?? `${year}-01-01`),
      accountBank:      String(r.account_bank      || d.accountBank),
      accountCash:      String(r.account_cash      || d.accountCash),
      accountRevenue7:  String(r.account_revenue_7 || d.accountRevenue7),
      accountRevenue19: String(r.account_revenue_19|| d.accountRevenue19),
      accountGoods7:    String(r.account_goods_7   || d.accountGoods7),
      accountGoods19:   String(r.account_goods_19  || d.accountGoods19),
      accountSuspense:  String(r.account_suspense  || d.accountSuspense),
      exportLabel:      String(r.export_label ?? 'Yumas GmbH'),
    };
  }, [draft, settingsRow, year]);

  const saveSettings = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await supabase.from('datev_settings').upsert({ id: 1, ...draft, updated_at: new Date().toISOString() });
      qc.invalidateQueries({ queryKey: ['datev-settings'] });
      setDraft(null);
    } finally { setSaving(false); }
  }, [draft, qc]);

  /* ── The mapping and the month's records ── */
  const { data: accounts = [] } = useQuery({
    queryKey: ['datev-accounts'],
    queryFn: async () => {
      const { data } = await supabase.from('datev_accounts').select('*');
      return (data ?? []) as AccountRow[];
    },
  });

  const { data: counterparties = [] } = useQuery({
    queryKey: ['counterparties'],
    queryFn: () => fetch('/api/counterparties').then(r => r.json()),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations-datev'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('id, name');
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const { data: month_ } = useQuery({
    queryKey: ['datev-month', from, to],
    queryFn: async () => {
      const [shifts, bills, wolt, lief, web, pays] = await Promise.all([
        supabase.from('shift_reports').select('report_date,location_id,gross_food,gross_beverages')
          .gte('report_date', from).lte('report_date', to),
        supabase.from('bills')
          .select('id,supplier_name,invoice_number,invoice_date,gross_amount,vat_amount,category,status')
          .gte('invoice_date', from).lte('invoice_date', to).neq('status', 'pending'),
        supabase.from('wolt_shift_sales').select('sale_date,net_sales,refund_est')
          .gte('sale_date', from).lte('sale_date', to),
        supabase.from('lieferando_shift_sales').select('sale_date,net_sales,refund_est,stamp_card_est')
          .gte('sale_date', from).lte('sale_date', to),
        supabase.from('webshop_orders').select('sale_date,net_cents,vat_cents,gross_cents').eq('counts', true)
          .gte('sale_date', from).lte('sale_date', to),
        supabase.from('cashflow_transactions').select('date,amount_cents,bill_id,counterparty')
          .not('bill_id', 'is', null).gte('date', from).lte('date', to),
      ]);

      /* The delivery platforms sell food, so their takings are 7% gross. The
         webshop states its own VAT, so the rate it carries decides. */
      const dayGross = (rows: { sale_date: string; net_sales: number; refund_est: number; stamp_card_est?: number | null }[]) => {
        const m = new Map<string, number>();
        for (const r of rows) {
          const net = Number(r.net_sales) + Number(r.refund_est ?? 0) + Number(r.stamp_card_est ?? 0);
          m.set(r.sale_date, (m.get(r.sale_date) ?? 0) + net * 1.07);
        }
        return m;
      };
      const otherSales: { date: string; label: string; gross7: number; gross19: number }[] = [];
      for (const [date, g] of dayGross((wolt.data ?? []) as never))       otherSales.push({ date, label: 'Wolt', gross7: g, gross19: 0 });
      for (const [date, g] of dayGross((lief.data ?? []) as never))       otherSales.push({ date, label: 'Lieferando', gross7: g, gross19: 0 });
      const webByDay = new Map<string, { g7: number; g19: number }>();
      for (const w of (web.data ?? []) as { sale_date: string; net_cents: number; vat_cents: number; gross_cents: number }[]) {
        const cur = webByDay.get(w.sale_date) ?? { g7: 0, g19: 0 };
        const at19 = w.net_cents > 0 && w.vat_cents / w.net_cents > 0.12;
        if (at19) cur.g19 += w.gross_cents / 100; else cur.g7 += w.gross_cents / 100;
        webByDay.set(w.sale_date, cur);
      }
      for (const [date, g] of webByDay) otherSales.push({ date, label: 'Webshop', gross7: g.g7, gross19: g.g19 });

      return {
        shifts: (shifts.data ?? []) as never[],
        bills:  (bills.data ?? []) as never[],
        otherSales,
        payments: ((pays.data ?? []) as { date: string; amount_cents: number; bill_id: string; counterparty: string }[])
          .map(p => ({ date: p.date, amount: Math.abs(p.amount_cents) / 100, billId: p.bill_id, counterparty: p.counterparty })),
      };
    },
  });

  /* A bill's counterparty, by the same keywords the rest of the app uses. */
  const billsWithCp = useMemo(() => {
    type Cp = { id: string; name: string; keywords: string[] };
    return ((month_?.bills ?? []) as { supplier_name: string }[]).map(b => {
      const lower = (b.supplier_name ?? '').toLowerCase();
      const cp = (counterparties as Cp[]).find(c => {
        const terms = c.keywords?.length ? c.keywords : [c.name];
        return terms.some(kw => kw && lower.includes(kw.toLowerCase()));
      });
      return { ...b, counterpartyId: cp?.id ?? null, counterpartyName: cp?.name ?? null };
    });
  }, [month_, counterparties]);

  const costCentres = useMemo(() =>
    Object.fromEntries((locations as { id: string; name: string }[]).map(l => [l.id, l.name.slice(0, 8)])),
  [locations]);

  const result = useMemo(() => {
    if (!month_) return null;
    /* A sales channel posts through its own clearing account, taken from the
       mapping under the channel's name. */
    const channelAccount = (label: string) =>
      accounts.find(a => a.scope === 'category' && a.ref === label)?.account ?? null;
    return buildPostings({
      shifts: month_.shifts,
      otherSales: month_.otherSales.map(r => ({ ...r, account: channelAccount(r.label) })),
      bills: billsWithCp as never,
      payments: month_.payments,
      accounts,
      costCentres,
    }, settings);
  }, [month_, billsWithCp, accounts, costCentres, settings]);

  const setAccount = useCallback(async (scope: 'counterparty' | 'category', ref: string, patch: Partial<AccountRow>) => {
    const existing = accounts.find(a => a.scope === scope && a.ref === ref);
    await supabase.from('datev_accounts').upsert({
      scope, ref,
      account:          patch.account          ?? existing?.account          ?? null,
      creditor_account: patch.creditor_account ?? existing?.creditor_account ?? null,
      bu_key:           patch.bu_key           ?? existing?.bu_key           ?? null,
      cost_centre:      patch.cost_centre      ?? existing?.cost_centre      ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'scope,ref' });
    qc.invalidateQueries({ queryKey: ['datev-accounts'] });
  }, [accounts, qc]);

  const download = useCallback(() => {
    if (!result) return;
    const csv = buildBuchungsstapel({
      settings, from, to, bookings: result.bookings,
      label: `Yumas ${MONTHS[month - 1]} ${year}`,
    });
    const url = URL.createObjectURL(new Blob([toWindows1252(csv) as BlobPart], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = buchungsstapelFilename(from, to); a.click();
    URL.revokeObjectURL(url);
    void supabase.from('datev_exports').insert({
      period_start: from, period_end: to, kind: 'bookings',
      booking_count: result.bookings.length,
      total_amount: result.bookings.reduce((t, b) => t + b.amount, 0),
      filename: buchungsstapelFilename(from, to),
    });
  }, [result, settings, from, to, month, year]);

  /**
   * The invoice images, zipped on the server: the PDFs sit in storage behind
   * the service role, and pulling a hundred signed URLs from here would be a
   * hundred round trips.
   */
  const downloadBelege = useCallback(async () => {
    setBelege({ busy: true, msg: null });
    try {
      const res = await fetch(`/api/datev/belege?from=${from}&to=${to}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'The archive could not be built.');
      }
      const included = res.headers.get('X-Beleg-Included') ?? '?';
      const missing  = Number(res.headers.get('X-Beleg-Missing') ?? 0);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DATEV_Belege_${from.replace(/-/g, '')}_${to.replace(/-/g, '')}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setBelege({
        busy: false,
        msg: `${included} Belege gepackt (${(blob.size / 1024 / 1024).toFixed(1)} MB)` +
          (missing > 0 ? ` · ${missing} Rechnung(en) ohne PDF sind nicht enthalten.` : '.'),
      });
    } catch (e) {
      setBelege({ busy: false, msg: e instanceof Error ? e.message : 'The archive could not be built.' });
    }
  }, [from, to]);

  const ready = !!settings.consultantNumber && !!settings.clientNumber;

  const field = (key: string, label: string, placeholder = '', width = 'w-40') => (
    <div>
      <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</label>
      <input
        value={(draft?.[key] ?? String((settingsRow as Record<string, string>)?.[key] ?? ''))}
        placeholder={placeholder}
        onChange={e => setDraft(d => ({ ...(d ?? {}), [key]: e.target.value }))}
        className={`${width} border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30`} />
    </div>
  );

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-2xl font-bold text-gray-900">DATEV</h1>
      <p className="text-sm text-gray-500 mb-5">
        The month as a Buchungsstapel · downloaded here and imported by the Steuerberater
      </p>

      <div className="flex items-center gap-1.5 mb-5">
        {([['export', 'Buchungsstapel'], ['mapping', 'Kontenzuordnung'], ['settings', 'Einstellungen']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
              tab === k ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-gray-600 border-gray-200 hover:border-slate-900'
            }`}>{l}</button>
        ))}
      </div>

      {/* ── Settings ── */}
      {tab === 'settings' && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 space-y-5">
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5 text-amber-500" />
            <span>
              Ask the Steuerberater for the Berater- and Mandantennummer, and which Kontenrahmen the client is on.
              The accounts below are the standard ones for that chart and should be confirmed before the first import —
              a wrong revenue account posts the whole month at the wrong VAT rate.
            </span>
          </div>

          <div className="flex flex-wrap gap-4">
            {field('consultant_number', 'Beraternummer', '1234567')}
            {field('client_number',     'Mandantennummer', '54321')}
            <div>
              <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Kontenrahmen</label>
              <select
                value={draft?.chart ?? String((settingsRow as Record<string, string>)?.chart ?? 'SKR03')}
                onChange={e => setDraft(d => ({ ...(d ?? {}), chart: e.target.value }))}
                className="w-40 border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white">
                <option value="SKR03">SKR03</option>
                <option value="SKR04">SKR04</option>
              </select>
            </div>
            {field('account_length',    'Sachkontenlänge', '4', 'w-28')}
            {field('fiscal_year_start', 'Wirtschaftsjahr ab', '2026-01-01')}
          </div>

          <div>
            <p className="text-xs font-bold text-gray-700 mb-2">Sachkonten</p>
            <div className="flex flex-wrap gap-4">
              {field('account_bank',       'Bank',            settings.accountBank,      'w-28')}
              {field('account_cash',       'Kasse',           settings.accountCash,      'w-28')}
              {field('account_revenue_7',  'Erlöse 7%',       settings.accountRevenue7,  'w-28')}
              {field('account_revenue_19', 'Erlöse 19%',      settings.accountRevenue19, 'w-28')}
              {field('account_goods_7',    'Wareneingang 7%', settings.accountGoods7,    'w-28')}
              {field('account_goods_19',   'Wareneingang 19%',settings.accountGoods19,   'w-28')}
            </div>
            <p className="mt-2 text-[11px] text-gray-400">
              These are Automatikkonten: the account itself carries the tax rate, so no BU-Schlüssel is written.
              A BU key is only used where a mapping below sets one explicitly.
            </p>
          </div>

          <div className="flex justify-end">
            <button onClick={saveSettings} disabled={!draft || saving}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-[#1B5E20] text-white rounded-lg hover:bg-[#2E7D32] disabled:opacity-40">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Speichern
            </button>
          </div>
        </div>
      )}

      {/* ── Mapping ── */}
      {tab === 'mapping' && (
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            One expense account and one creditor account per supplier. The creditor account is what keeps an
            invoice an open item until it is paid, which is what lets the Steuerberater see what is still owed.
            Sales channels take a clearing account, because the takings and the payout are days apart.
          </p>
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Gegenpartei</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Kategorie</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Aufwandskonto</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Kreditorenkonto</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Kostenstelle</th>
                </tr>
              </thead>
              <tbody>
                {(counterparties as { id: string; name: string; category: string | null }[]).map(cp => {
                  const row = accounts.find(a => a.scope === 'counterparty' && a.ref === cp.id);
                  const cell = (k: 'account' | 'creditor_account' | 'cost_centre', ph: string) => (
                    <td className="px-3 py-1.5">
                      <input defaultValue={row?.[k] ?? ''} placeholder={ph}
                        onBlur={e => { if (e.target.value !== (row?.[k] ?? '')) void setAccount('counterparty', cp.id, { [k]: e.target.value || null }); }}
                        className="w-28 border border-gray-200 rounded px-2 py-1 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-[#1B5E20]/40" />
                    </td>
                  );
                  return (
                    <tr key={cp.id} className="border-b border-gray-50">
                      <td className="px-3 py-1.5 font-medium text-gray-800">{cp.name}</td>
                      <td className="px-3 py-1.5 text-gray-400">{cp.category ?? '—'}</td>
                      {cell('account', settings.accountGoods7)}
                      {cell('creditor_account', '70001')}
                      {cell('cost_centre', '')}
                    </tr>
                  );
                })}
                {['Wolt', 'Lieferando', 'Webshop', 'Nexi'].map(label => {
                  const row = accounts.find(a => a.scope === 'category' && a.ref === label);
                  return (
                    <tr key={label} className="border-b border-gray-50 bg-blue-50/30">
                      <td className="px-3 py-1.5 font-medium text-gray-800">{label}</td>
                      <td className="px-3 py-1.5 text-gray-400 italic">Verrechnungskonto</td>
                      <td className="px-3 py-1.5">
                        <input defaultValue={row?.account ?? ''} placeholder="1360"
                          onBlur={e => { if (e.target.value !== (row?.account ?? '')) void setAccount('category', label, { account: e.target.value || null }); }}
                          className="w-28 border border-gray-200 rounded px-2 py-1 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-[#1B5E20]/40" />
                      </td>
                      <td colSpan={2} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Export ── */}
      {tab === 'export' && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <CalendarDays size={13} className="text-gray-400" />
            <select value={month} onChange={e => setMonth(Number(e.target.value))}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 bg-white">
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select value={year} onChange={e => setYear(Number(e.target.value))}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 bg-white">
              {[today.getFullYear(), today.getFullYear() - 1, today.getFullYear() - 2].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={downloadBelege} disabled={belege.busy || !ready}
              title="The invoice PDFs with their metadata, for Belegtransfer into Unternehmen online"
              className="ml-auto flex items-center gap-2 px-4 py-2 text-xs font-bold border border-[#1B5E20] text-[#1B5E20] rounded-lg hover:bg-green-50 disabled:opacity-40">
              {belege.busy ? <Loader2 size={14} className="animate-spin" /> : <FileArchive size={14} />}
              {belege.busy ? 'Belege werden gepackt…' : 'Belege (ZIP)'}
            </button>
            <button onClick={download} disabled={!result?.bookings.length || !ready}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-[#1B5E20] text-white rounded-lg hover:bg-[#2E7D32] disabled:opacity-40">
              <Download size={14} /> Buchungsstapel herunterladen
            </button>
          </div>

          {belege.msg && (
            <div className="flex items-start gap-2 p-3 mb-4 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-700">
              <FileArchive size={14} className="flex-shrink-0 mt-0.5 text-gray-400" />
              <span className="flex-1">{belege.msg}</span>
              <button onClick={() => setBelege(b => ({ ...b, msg: null }))} className="text-gray-400 hover:text-gray-600">×</button>
            </div>
          )}

          {!ready && (
            <div className="flex items-start gap-2 p-3 mb-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
              <Settings2 size={14} className="flex-shrink-0 mt-0.5 text-amber-500" />
              <span>Berater- and Mandantennummer are missing — DATEV will not read a batch without them. Fill them in under Einstellungen.</span>
            </div>
          )}

          {result && (
            <>
              <div className="grid grid-cols-4 gap-3 mb-5">
                {[
                  ['Buchungen', String(result.bookings.length), 'text-gray-900'],
                  ['Erlöse',    eur(result.revenueTotal),  'text-green-700'],
                  ['Eingangsrechnungen', eur(result.purchaseTotal), 'text-red-700'],
                  ['Zahlungen', eur(result.paymentTotal), 'text-blue-700'],
                ].map(([label, value, cls]) => (
                  <div key={label} className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{label}</p>
                    <p className={`text-lg font-bold tabular-nums ${cls}`}>{value}</p>
                  </div>
                ))}
              </div>

              {result.gaps.length > 0 && (
                <div className="mb-5">
                  <h2 className="text-sm font-bold text-gray-900 mb-2">Nicht gebucht — Zuordnung fehlt</h2>
                  <div className="bg-white border border-amber-200 rounded-xl overflow-hidden">
                    {result.gaps.map(g => (
                      <div key={g.kind + g.name} className="flex items-center gap-3 px-4 py-2 border-b border-amber-50 last:border-0">
                        <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />
                        <span className="text-xs font-semibold text-gray-800 w-52 truncate">{g.name}</span>
                        <span className="text-[11px] text-gray-500 flex-1">{g.hint}</span>
                        <span className="text-[11px] text-gray-400">{g.count}×</span>
                        <span className="text-xs font-bold text-gray-700 tabular-nums w-28 text-right">{eur(g.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <h2 className="text-sm font-bold text-gray-900 mb-2">
                Buchungssätze <span className="text-gray-400 font-normal">{de(from)} – {de(to)}</span>
              </h2>
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <div className="max-h-[28rem] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Datum</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase tracking-wide">Umsatz</th>
                        <th className="px-3 py-2 text-center font-semibold text-gray-500 uppercase tracking-wide">S/H</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Konto</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Gegenkonto</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Beleg</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Buchungstext</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">KOST</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.bookings.map((b, i) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/60">
                          <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{de(b.date)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-gray-900">{eur(b.amount)}</td>
                          <td className="px-3 py-1.5 text-center text-gray-400">{b.debitCredit}</td>
                          <td className="px-3 py-1.5 font-mono text-gray-700">{b.account}</td>
                          <td className="px-3 py-1.5 font-mono text-gray-700">{b.contraAccount}</td>
                          <td className="px-3 py-1.5 text-gray-400">{b.reference ?? '—'}</td>
                          <td className="px-3 py-1.5 text-gray-600 max-w-[240px] truncate">{b.text}</td>
                          <td className="px-3 py-1.5 text-gray-400">{b.costCentre ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="mt-4 mb-10 text-xs text-gray-400 flex items-start gap-2">
                <BookOpen size={13} className="flex-shrink-0 mt-0.5" />
                <span>
                  Revenue posts gross against the cash account and the delivery platforms against their own clearing
                  account, so the takings and the payout that settles them meet there rather than doubling the bank.
                  A supplier invoice posts to its creditor account and stays an open item until a linked payment
                  closes it. Send the first batch as a test import: DATEV says little about why it rejects a file,
                  so it is worth finding out on a month you can throw away.
                </span>
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
