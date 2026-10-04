'use client';

/**
 * The month's folder for the Steuerberater.
 *
 * Until the DATEV link arrives the handover is a printed folder, and the thing
 * that goes wrong is not assembling it but noticing what is missing — a Nexi
 * statement nobody uploaded, a bill whose PDF never arrived. So the page is a
 * checklist first and a download second: every item the month owes, what it
 * has, and what is still open.
 *
 * What the list contains is declared in lib/month-folder.ts. Adding to it is a
 * line there; this page needs no changes.
 */

import React, { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderDown, Upload, Check, AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { monthLabel } from '@/lib/month-folder';

type Item = {
  key: string; label: string; folder: string; source: 'collected' | 'uploaded';
  required: boolean; note: string; count: number; missingFiles: number; detail?: string;
};

const thisMonth = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);      // the month just ended is the one being closed
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function MonatsabschlussPage() {
  const [month, setMonth] = useState(thisMonth());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['month-folder', month],
    queryFn: async () => {
      const r = await fetch(`/api/month-folder?month=${month}`);
      if (!r.ok) throw new Error((await r.json()).error ?? 'failed');
      return r.json() as Promise<{ items: Item[]; label: string;
        summary: { ready: boolean; documents: number; missing: unknown[]; partial: unknown[] } }>;
    },
  });

  /**
   * Upload a statement against this month; the same kind twice replaces.
   *
   * Through the server, like every other write to this bucket. The bucket and
   * the table are closed to the browser client, and writing from here directly
   * was refused with "new row violates row-level security policy".
   */
  async function upload(kind: string, file: File) {
    setBusy(kind); setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('kind', kind);
      body.append('month', month);
      const r = await fetch('/api/month-folder/upload', { method: 'POST', body });
      if (!r.ok) throw new Error((await r.json()).error ?? 'Upload fehlgeschlagen');
      await qc.invalidateQueries({ queryKey: ['month-folder', month] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload fehlgeschlagen');
    } finally { setBusy(null); }
  }

  async function remove(kind: string) {
    setBusy(kind); setError(null);
    try {
      const r = await fetch(`/api/month-folder/upload?kind=${kind}&month=${month}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error ?? 'Entfernen fehlgeschlagen');
      await qc.invalidateQueries({ queryKey: ['month-folder', month] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Entfernen fehlgeschlagen');
    } finally { setBusy(null); }
  }

  async function download() {
    setBusy('zip'); setError(null);
    try {
      const r = await fetch(`/api/month-folder?month=${month}`, { method: 'POST' });
      if (!r.ok) throw new Error((await r.json()).error ?? 'failed');
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Yumas_Monatsabschluss_${month}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download fehlgeschlagen');
    } finally { setBusy(null); }
  }

  const items = data?.items ?? [];
  const months = Array.from({ length: 18 }, (_, i) => {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <FolderDown size={20} /> Monatsabschluss
          </h1>
          <p className="text-xs text-gray-500">
            Alle Unterlagen für den Steuerberater an einem Ort · als ZIP zum Ausdrucken
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={month} onChange={e => setMonth(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white">
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <button onClick={download} disabled={busy === 'zip'}
            className="inline-flex items-center gap-1.5 bg-[#1B5E20] hover:bg-[#2E7D32] disabled:opacity-50 text-white rounded-lg px-3 py-1.5 text-xs font-semibold">
            {busy === 'zip' ? <Loader2 size={13} className="animate-spin" /> : <FolderDown size={13} />}
            ZIP herunterladen
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>
      )}

      {data && (
        <div className={'mb-3 px-3 py-2 rounded-lg border text-xs flex items-center gap-2 '
          + (data.summary.ready ? 'bg-green-50 border-green-200 text-green-800'
                                : 'bg-amber-50 border-amber-200 text-amber-800')}>
          {data.summary.ready ? <Check size={14} /> : <AlertTriangle size={14} />}
          {data.summary.ready
            ? <span><strong>{monthLabel(month)} ist vollständig</strong> · {data.summary.documents} Dokumente</span>
            : <span><strong>{data.summary.missing.length} Position(en) fehlen noch</strong> · bisher {data.summary.documents} Dokumente</span>}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto border border-gray-200 rounded-xl bg-white">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-gray-400">Lädt…</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
                <th className="px-4 py-2 font-semibold">Ordner</th>
                <th className="px-4 py-2 font-semibold">Unterlage</th>
                <th className="px-4 py-2 font-semibold text-right">Dateien</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => {
                const ok = it.count > 0;
                return (
                  <tr key={it.key} className="border-b border-gray-100 hover:bg-gray-50/60">
                    <td className="px-4 py-2 font-mono text-[11px] text-gray-400 whitespace-nowrap">{it.folder}</td>
                    <td className="px-4 py-2">
                      <div className="font-semibold text-gray-800">{it.label}</div>
                      <div className="text-[11px] text-gray-500">{it.note}</div>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-700">
                      {it.count || <span className="text-gray-300">—</span>}
                      {it.detail && <div className="text-[10px] font-normal text-gray-400">{it.detail}</div>}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {ok ? (
                        <span className="inline-flex items-center gap-1 text-green-700"><Check size={12} /> vorhanden</span>
                      ) : it.required ? (
                        <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle size={12} /> fehlt</span>
                      ) : (
                        <span className="text-gray-400">optional</span>
                      )}
                      {it.missingFiles > 0 && (
                        <div className="text-[10px] text-amber-700">{it.missingFiles} ohne PDF</div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {it.source === 'uploaded' ? (
                        <>
                          <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.csv"
                            ref={el => { inputs.current[it.key] = el; }}
                            onChange={e => { const f = e.target.files?.[0]; e.target.value = '';
                              if (f) upload(it.key, f); }} />
                          <button onClick={() => inputs.current[it.key]?.click()} disabled={busy === it.key}
                            className="inline-flex items-center gap-1 border border-gray-200 hover:bg-gray-50 disabled:opacity-50 rounded-lg px-2 py-1 text-[11px] font-semibold text-gray-600">
                            {busy === it.key ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                            {ok ? 'ersetzen' : 'hochladen'}
                          </button>
                          {ok && (
                            <button onClick={() => remove(it.key)} title="Entfernen"
                              className="ml-1 p-1 text-gray-300 hover:text-red-600"><Trash2 size={12} /></button>
                          )}
                        </>
                      ) : (
                        <span className="text-[11px] text-gray-400">automatisch</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="px-4 py-2 mt-2 text-[11px] text-gray-500">
        Die mit <em>automatisch</em> gekennzeichneten Positionen werden aus dem System gesammelt:
        Eingangsrechnungen nach Rechnungsdatum, Ausgangsrechnungen auf Abgrenzungsbasis — Rechnungsdatum im
        Monat, auch unbezahlt, zuzüglich älterer Rechnungen mit Zahlungseingang in diesem Monat. Die übrigen
        kommen nur als PDF und werden hier hochgeladen. Das ZIP enthält je Position einen nummerierten Ordner
        in Druckreihenfolge und vorne eine Checkliste, die festhält, was enthalten ist und was fehlt.
        {' '}Die Rechnungen sind nach dem Kontoauszug benannt — <code>S03_029_…</code> heißt Seite 3,
        Buchung 29 — und lassen sich so der Reihe nach hinter die jeweilige Seite heften, ohne zu suchen.
        Dafür muss der Kontoauszug hochgeladen sein. Rechnungen ohne Zahlung in diesem Monat stehen unter
        <code> ZZ_ohne_Zahlung_im_Monat_</code> am Ende.
      </div>
    </div>
  );
}
