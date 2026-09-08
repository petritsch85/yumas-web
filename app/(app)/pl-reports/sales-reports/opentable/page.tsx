'use client';

/**
 * OpenTable — raw reservations from GuestCenter.
 *
 * This page shows the export as it arrived, before any of it is rolled into
 * the P&L, so the Bookings line in the Sales Report can always be traced back
 * to the reservations behind it.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { MapPin, CalendarCheck, Users } from 'lucide-react';

interface OpenTableRow {
  id:          string;
  location_id: string;
  visit_date:  string;
  visit_time:  string | null;
  shift:       'lunch' | 'dinner';
  guest_name:  string | null;
  phone:       string | null;
  party_size:  number;
  status:      string | null;
  counts:      boolean;
  table:       string | null;
  source:      string | null;
  requests:    string | null;
  notes:       string | null;
  tags:        string | null;
}

/** "2026-09-08" → "08.09.2026" */
const de = (iso: string) => iso.split('-').reverse().join('.');

const DOW = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const dow = (iso: string) => DOW[new Date(iso + 'T12:00:00Z').getUTCDay()];

const PAGE = 200;

export default function OpenTablePage() {
  const [locationId, setLocationId] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [shift, setShift] = useState<'all' | 'lunch' | 'dinner'>('all');
  const [page, setPage] = useState(0);

  const { data: locations = [] } = useQuery({
    queryKey: ['locations-opentable'],
    queryFn: async () => {
      const { data } = await supabase
        .from('locations').select('id, name, type').eq('is_active', true).order('name');
      return ((data ?? []) as { id: string; name: string; type: string }[])
        .filter(l => l.type === 'restaurant')
        .map(({ id, name }) => ({ id, name }));
    },
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['opentable-bookings', locationId],
    queryFn: async () => {
      // PostgREST caps a response at 1000 rows and a busy season will pass that.
      const all: OpenTableRow[] = [];
      for (let p = 0; ; p++) {
        let q = supabase.from('opentable_bookings').select('*')
          .order('visit_date', { ascending: false })
          .order('visit_time', { ascending: true })
          .range(p * 1000, (p + 1) * 1000 - 1);
        if (locationId) q = q.eq('location_id', locationId);
        const { data, error } = await q;
        if (error) throw error;
        if (!data?.length) break;
        all.push(...(data as OpenTableRow[]));
        if (data.length < 1000) break;
      }
      return all;
    },
  });

  const locationName = useMemo(() => {
    const m = new Map(locations.map(l => [l.id, l.name]));
    return (id: string) => m.get(id) ?? '—';
  }, [locations]);

  const visible = useMemo(
    () => rows
      .filter(r => showCancelled || r.counts)
      .filter(r => shift === 'all' || r.shift === shift),
    [rows, showCancelled, shift],
  );
  const pageRows  = visible.slice(page * PAGE, (page + 1) * PAGE);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE));

  const counted   = rows.filter(r => r.counts);
  const cancelled = rows.length - counted.length;

  /** Covers per date and shift — what the Bookings line in the P&L reads. */
  const byDate = useMemo(() => {
    const m = new Map<string, { lunch: number; dinner: number; n: number }>();
    for (const r of counted) {
      const cur = m.get(r.visit_date) ?? { lunch: 0, dinner: 0, n: 0 };
      cur[r.shift] += r.party_size;
      cur.n += 1;
      m.set(r.visit_date, cur);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [counted]);

  const dateRange = useMemo(() => {
    if (counted.length === 0) return null;
    const d = counted.map(r => r.visit_date).sort();
    return `${de(d[0])} – ${de(d[d.length - 1])}`;
  }, [counted]);

  const dinnerCovers = counted.filter(r => r.shift === 'dinner').reduce((s, r) => s + r.party_size, 0);
  const lunchCovers  = counted.filter(r => r.shift === 'lunch').reduce((s, r) => s + r.party_size, 0);

  const todayKey = new Date().toISOString().slice(0, 10);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900">OpenTable</h1>
      <p className="text-sm text-gray-500 mb-5">
        Reservations from GuestCenter — the booked covers behind the P&amp;L&rsquo;s Bookings line
      </p>

      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-1.5">
          <MapPin size={13} className="text-gray-400" />
          <select
            value={locationId}
            onChange={e => { setLocationId(e.target.value); setPage(0); }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 cursor-pointer"
          >
            <option value="">All locations</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="flex gap-1">
          {(['all', 'lunch', 'dinner'] as const).map(s => (
            <button key={s} onClick={() => { setShift(s); setPage(0); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                shift === s ? 'bg-[#1B5E20] text-white border-[#1B5E20]' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
              }`}>
              {s === 'all' ? 'Both shifts' : s === 'lunch' ? '☀️ Lunch' : '🌙 Dinner'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={showCancelled}
            onChange={e => { setShowCancelled(e.target.checked); setPage(0); }}
            className="w-3.5 h-3.5 accent-[#1B5E20]" />
          Show cancellations / no-shows ({cancelled})
        </label>
      </div>

      {/* ── Covers per day ── */}
      <h2 className="text-lg font-bold text-gray-900 mb-1">Booked covers by day</h2>
      <p className="text-sm text-gray-500 mb-3">
        Every reservation imported{dateRange && ` · ${dateRange}`} · cancellations excluded
      </p>

      <div className="grid grid-cols-3 gap-3 mb-4 max-w-2xl">
        {[
          { label: 'Reservations', value: counted.length.toLocaleString('de-DE'), tone: 'text-gray-800' },
          { label: '☀️ Lunch covers',  value: lunchCovers.toLocaleString('de-DE'),  tone: 'text-amber-700' },
          { label: '🌙 Dinner covers', value: dinnerCovers.toLocaleString('de-DE'), tone: 'text-blue-700' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{s.label}</p>
            <p className={`text-xl font-bold tabular-nums ${s.tone}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden mb-8">
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0">
              <tr className="bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-right">Reservations</th>
                <th className="px-3 py-2 text-right">☀️ Lunch</th>
                <th className="px-4 py-2 text-right">🌙 Dinner</th>
              </tr>
            </thead>
            <tbody>
              {byDate.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-400">
                  <CalendarCheck size={26} className="mx-auto mb-2 text-gray-200" />
                  {isLoading ? 'Loading…' : 'No reservations yet — import the export from Sales Reports → Upload → OpenTable'}
                </td></tr>
              )}
              {byDate.map(([date, v]) => (
                <tr key={date} className={`border-b border-gray-50 hover:bg-gray-50/60 ${date >= todayKey ? '' : 'text-gray-400'}`}>
                  <td className="px-4 py-1.5 whitespace-nowrap">
                    <span className="text-gray-400 text-xs mr-1.5">{dow(date)}</span>
                    <span className="font-medium">{de(date)}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{v.n}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{v.lunch || <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums font-semibold">{v.dinner || <span className="text-gray-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── The reservations themselves ── */}
      <h2 className="text-lg font-bold text-gray-900 mb-1">Reservations</h2>
      <p className="text-sm text-gray-500 mb-3">{visible.length.toLocaleString('de-DE')} shown</p>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Shift</th>
                <th className="px-3 py-2 text-left">Guest</th>
                <th className="px-3 py-2 text-right">Covers</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Table</th>
                <th className="px-3 py-2 text-left">Source</th>
                {!locationId && <th className="px-3 py-2 text-left">Location</th>}
                <th className="px-4 py-2 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-gray-400">
                  {isLoading ? 'Loading…' : 'Nothing to show'}
                </td></tr>
              )}
              {pageRows.map(r => (
                <tr key={r.id} className={`border-b border-gray-50 hover:bg-gray-50/60 ${r.counts ? '' : 'opacity-50 line-through'}`}>
                  <td className="px-4 py-1.5 whitespace-nowrap">
                    <span className="text-gray-400 text-xs mr-1.5">{dow(r.visit_date)}</span>{de(r.visit_date)}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-gray-600 whitespace-nowrap">{r.visit_time || '—'}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{r.shift === 'lunch' ? '☀️' : '🌙'}</td>
                  <td className="px-3 py-1.5 max-w-[200px] truncate" title={r.guest_name ?? ''}>{r.guest_name || '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{r.party_size}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-500 whitespace-nowrap">{r.status || '—'}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-500">{r.table || '—'}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-500 whitespace-nowrap">{r.source || '—'}</td>
                  {!locationId && <td className="px-3 py-1.5 text-xs text-gray-500 whitespace-nowrap">{locationName(r.location_id)}</td>}
                  <td className="px-4 py-1.5 text-xs text-gray-400 max-w-[260px] truncate"
                      title={[r.requests, r.notes, r.tags].filter(Boolean).join(' · ')}>
                    {[r.requests, r.notes, r.tags].filter(Boolean).join(' · ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 bg-gray-50 text-xs">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
              className="px-3 py-1 rounded-lg border border-gray-200 bg-white disabled:opacity-40">Previous</button>
            <span className="text-gray-500 flex items-center gap-1.5"><Users size={12} />Page {page + 1} of {pageCount}</span>
            <button disabled={page + 1 >= pageCount} onClick={() => setPage(p => p + 1)}
              className="px-3 py-1 rounded-lg border border-gray-200 bg-white disabled:opacity-40">Next</button>
          </div>
        )}
      </div>
    </div>
  );
}
