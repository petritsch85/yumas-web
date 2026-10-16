'use client';

/**
 * Staff costs, one month at a time, from the payroll's FiBu-Journal.
 *
 * Wages, the Krankenkassen and the Lohnsteuer leave the bank as dozens of
 * transfers with no invoice behind any of them, so until a journal is filed
 * the P&L carries a typed placeholder for the month. Uploading the journal
 * replaces it with the payroll's own reconciled figure.
 */

import React, { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, Upload, Loader2, AlertTriangle, Check } from 'lucide-react';

type Row = {
  month: string; total: number; total_haben: number | null;
  filename: string | null; uploaded_at: string;
};

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
  'August', 'September', 'Oktober', 'November', 'Dezember'];
const monthLabel = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const eur = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

export default function StaffCostsPage() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['staff-costs'],
    queryFn: async () => {
      const res = await fetch('/api/staff-costs');
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'Laden fehlgeschlagen');
      return j.months as Row[];
    },
  });

  const upload = async (file: File) => {
    setBusy(true); setError(null); setDone(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/staff-costs', { method: 'POST', body: form });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `Upload fehlgeschlagen (${res.status})`);
      setDone(`${monthLabel(j.month)}: ${eur(j.total)}${j.replaced ? ' — ersetzt die vorherige Fassung' : ''}`);
      qc.invalidateQueries({ queryKey: ['staff-costs'] });
      /* The P&L reads the same table. */
      qc.invalidateQueries({ queryKey: ['group-monthly'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Users size={22} className="text-[#1B5E20]" /> Staff costs
        </h1>
        <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
        <button onClick={() => input.current?.click()} disabled={busy}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white rounded-lg bg-[#1B5E20] hover:bg-[#164a1a] disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          FiBu-Journal hochladen
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Monatliche Personalkosten aus dem FiBu-Journal (Sage HR) — Abstimmung des Lohnverrechnungskontos 3790.
        Ersetzt den Platzhalter in der GuV.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />{error}
        </div>
      )}
      {done && (
        <div className="mb-4 flex items-start gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800">
          <Check size={15} className="mt-0.5 shrink-0" />{done}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
              <th className="px-4 py-2">Monat</th>
              <th className="px-4 py-2 text-right">Personalkosten</th>
              <th className="px-4 py-2">Abstimmung</th>
              <th className="px-4 py-2">Datei</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                <Loader2 size={16} className="animate-spin inline" /></td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-xs text-gray-400">
                Noch kein Journal hochgeladen.</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.month}>
                <td className="px-4 py-2.5 font-medium text-gray-900">{monthLabel(r.month)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-bold text-gray-900">{eur(Number(r.total))}</td>
                <td className="px-4 py-2.5 text-xs">
                  <span className="inline-flex items-center gap-1 text-green-700 font-semibold">
                    <Check size={12} /> Soll = Haben
                  </span>
                </td>
                <td className="px-4 py-2.5 text-[11px] text-gray-500 truncate max-w-[260px]">
                  {r.filename}
                  <span className="block text-gray-400">
                    hochgeladen {new Date(r.uploaded_at).toLocaleDateString('de-DE')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
