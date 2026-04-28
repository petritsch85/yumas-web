'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  Package, Truck, CheckCircle2, Clock, AlertCircle, ChevronDown, ChevronUp,
} from 'lucide-react';

/* ─── Types ─────────────────────────────────────────────────────────────── */
type Run = {
  id: string;
  delivery_date: string;
  packing_started_at: string | null;
  packing_finished_at: string | null;
  packing_duration_seconds: number | null;
  items_packed_count: number | null;
  packed_by: string | null;
  delivery_started_at: string | null;
  delivery_started_by: string | null;
};

type DeliveryLine = {
  id: string;
  location_name: string;
  section: string;
  item_name: string;
  unit: string;
  delivery_qty: number;
};

type Receipt = {
  id: string;
  run_id: string;
  location_name: string;
  received_at: string;
  received_by: string | null;
  items_confirmed_count: number | null;
};

type ProfileMap = Record<string, string>; // id → full_name

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const STORES = ['Eschborn', 'Taunus', 'Westend'] as const;
type Store = typeof STORES[number];

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function fmtDuration(seconds: number | null): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m} min`;
  return `${m} min ${s}s`;
}

/* ─── Timeline event row ─────────────────────────────────────────────────── */
function TimelineEvent({
  done, time, title, subtitle, color = 'green',
}: {
  done: boolean; time: string | null; title: string; subtitle?: string; color?: 'green' | 'blue' | 'gray';
}) {
  const dotColor = done
    ? color === 'blue' ? 'bg-blue-500' : 'bg-[#1B5E20]'
    : 'bg-gray-200';
  const textColor = done ? 'text-gray-900' : 'text-gray-400';

  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className={`w-3 h-3 rounded-full mt-1 flex-shrink-0 ${dotColor}`} />
        <div className="w-px flex-1 bg-gray-100 mt-1" />
      </div>
      <div className="pb-6">
        <div className={`flex items-center gap-3 flex-wrap`}>
          <span className={`text-sm font-semibold ${textColor}`}>{title}</span>
          {time && done && (
            <span className="text-xs text-gray-400 font-mono">{time}</span>
          )}
        </div>
        {subtitle && (
          <p className={`text-xs mt-0.5 ${done ? 'text-gray-500' : 'text-gray-300'}`}>{subtitle}</p>
        )}
      </div>
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────────────────── */
export default function DeliveryReportsPage() {
  const qc = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [localChecked, setLocalChecked] = useState<Record<string, boolean>>({});
  const [submittingReceipt, setSubmittingReceipt] = useState(false);
  const [expandReceiving, setExpandReceiving] = useState(true);

  /* Profile + location */
  const { data: profile } = useQuery({
    queryKey: ['dr-profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from('profiles').select('*, location:locations(name)').eq('id', user.id).single();
      return data as { id: string; full_name: string; role: string; location_id: string | null; location?: { name: string } | null } | null;
    },
  });

  const myLocationName = profile?.location?.name ?? null;
  const isAdmin = profile?.role === 'admin' || profile?.role === 'manager';

  /* Recent runs list */
  const { data: runs = [] } = useQuery<Run[]>({
    queryKey: ['delivery-runs-list'],
    queryFn: async () => {
      const { data } = await supabase
        .from('delivery_runs')
        .select('id, delivery_date, packing_started_at, packing_finished_at, packing_duration_seconds, items_packed_count, packed_by, delivery_started_at, delivery_started_by')
        .order('delivery_date', { ascending: false })
        .limit(14);
      return (data ?? []) as Run[];
    },
  });

  const activeRun: Run | null = useMemo(() => {
    if (!runs.length) return null;
    if (selectedRunId) return runs.find(r => r.id === selectedRunId) ?? runs[0];
    return runs[0];
  }, [runs, selectedRunId]);

  /* Lines for active run */
  const { data: lines = [] } = useQuery<DeliveryLine[]>({
    queryKey: ['dr-lines', activeRun?.id],
    enabled: !!activeRun,
    queryFn: async () => {
      const { data } = await supabase
        .from('delivery_run_lines')
        .select('id, location_name, section, item_name, unit, delivery_qty')
        .eq('run_id', activeRun!.id)
        .gt('delivery_qty', 0)
        .order('section').order('item_name');
      return (data ?? []) as DeliveryLine[];
    },
  });

  /* Receipts for active run */
  const { data: receipts = [] } = useQuery<Receipt[]>({
    queryKey: ['dr-receipts', activeRun?.id],
    enabled: !!activeRun,
    queryFn: async () => {
      const { data } = await supabase
        .from('store_delivery_receipts')
        .select('*')
        .eq('run_id', activeRun!.id);
      return (data ?? []) as Receipt[];
    },
  });

  /* All profiles for name lookup */
  const { data: profileMap = {} } = useQuery<ProfileMap>({
    queryKey: ['dr-profiles'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, full_name');
      const map: ProfileMap = {};
      for (const p of data ?? []) map[p.id] = p.full_name;
      return map;
    },
    staleTime: Infinity,
  });

  /* Submit receipt mutation */
  const submitReceipt = useMutation({
    mutationFn: async ({ runId, locationName, count }: { runId: string; locationName: string; count: number }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('store_delivery_receipts').upsert({
        run_id: runId,
        location_name: locationName,
        received_at: new Date().toISOString(),
        received_by: user?.id ?? null,
        items_confirmed_count: count,
      }, { onConflict: 'run_id,location_name' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dr-receipts', activeRun?.id] });
    },
  });

  /* Derived */
  const myLines = myLocationName ? lines.filter(l => l.location_name === myLocationName) : [];
  const myReceipt = myLocationName ? receipts.find(r => r.location_name === myLocationName) : null;
  const myCheckedCount = myLines.filter(l => localChecked[l.id]).length;

  const receiptByLocation = (loc: string) => receipts.find(r => r.location_name === loc) ?? null;

  const handleConfirmReceipt = async () => {
    if (!activeRun || !myLocationName) return;
    setSubmittingReceipt(true);
    try {
      await submitReceipt.mutateAsync({
        runId: activeRun.id,
        locationName: myLocationName,
        count: myLines.length,
      });
      setLocalChecked({});
    } finally {
      setSubmittingReceipt(false);
    }
  };

  /* ─── Render ─────────────────────────────────────────────────────────── */
  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Delivery Reports</h1>
        <p className="text-sm text-gray-500 mt-0.5">Full chronological log of each delivery run</p>
      </div>

      {/* Run selector */}
      {runs.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {runs.map(run => (
            <button
              key={run.id}
              onClick={() => { setSelectedRunId(run.id); setLocalChecked({}); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                activeRun?.id === run.id
                  ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}
            >
              {fmtDate(run.delivery_date)}
            </button>
          ))}
        </div>
      )}

      {!activeRun ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center text-gray-400 text-sm">
          <Package size={32} className="mx-auto text-gray-200 mb-3" />
          No delivery runs found yet.
        </div>
      ) : (
        <div className="space-y-5">

          {/* ── Timeline card ── */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-5">Timeline</h2>

            <div>
              {/* Packing started */}
              <TimelineEvent
                done={!!activeRun.packing_started_at}
                time={fmt(activeRun.packing_started_at)}
                title="Packing started"
                subtitle={activeRun.packed_by ? `by ${profileMap[activeRun.packed_by] ?? '—'}` : undefined}
              />

              {/* Packing finished */}
              <TimelineEvent
                done={!!activeRun.packing_finished_at}
                time={fmt(activeRun.packing_finished_at)}
                title="Packing finished"
                subtitle={[
                  activeRun.items_packed_count != null ? `${activeRun.items_packed_count} items packed` : null,
                  activeRun.packing_duration_seconds != null ? fmtDuration(activeRun.packing_duration_seconds) : null,
                  activeRun.packed_by ? `by ${profileMap[activeRun.packed_by] ?? '—'}` : null,
                ].filter(Boolean).join(' · ')}
              />

              {/* Delivery started */}
              <TimelineEvent
                done={!!activeRun.delivery_started_at}
                time={fmt(activeRun.delivery_started_at)}
                title="Delivery started"
                color="blue"
                subtitle={activeRun.delivery_started_by ? `by ${profileMap[activeRun.delivery_started_by] ?? '—'}` : undefined}
              />

              {/* Per-store receipts */}
              {STORES.map((store, idx) => {
                const receipt = receiptByLocation(store);
                const isLast = idx === STORES.length - 1;
                return (
                  <div key={store} className={isLast ? '[&>div>div:last-child]:hidden' : ''}>
                    <TimelineEvent
                      done={!!receipt}
                      time={receipt ? fmt(receipt.received_at) : null}
                      title={`${store} — delivery received`}
                      subtitle={receipt ? [
                        receipt.items_confirmed_count != null ? `${receipt.items_confirmed_count} items confirmed` : null,
                        receipt.received_by ? `by ${profileMap[receipt.received_by] ?? '—'}` : null,
                      ].filter(Boolean).join(' · ') : 'Awaiting confirmation'}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Store receiving card (store managers only, if delivery started) ── */}
          {myLocationName && !isAdmin && activeRun.delivery_started_at && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <button
                onClick={() => setExpandReceiving(v => !v)}
                className="w-full flex items-center justify-between px-6 py-4 text-left"
              >
                <div className="flex items-center gap-3">
                  <Truck size={18} className="text-[#1B5E20]" />
                  <div>
                    <p className="font-semibold text-gray-900">Incoming Delivery — {myLocationName}</p>
                    {myReceipt ? (
                      <p className="text-xs text-green-600 mt-0.5 flex items-center gap-1">
                        <CheckCircle2 size={12} /> Delivery confirmed at {fmt(myReceipt.received_at)}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {myCheckedCount} / {myLines.length} items checked off
                      </p>
                    )}
                  </div>
                </div>
                {expandReceiving ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
              </button>

              {expandReceiving && (
                <div className="border-t border-gray-100">
                  {myLines.length === 0 ? (
                    <div className="px-6 py-8 text-center text-gray-400 text-sm">No items to deliver to {myLocationName}</div>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 border-b border-gray-100">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Item</th>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Unit</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-[#1B5E20] uppercase tracking-wide">Qty</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">✓</th>
                            </tr>
                          </thead>
                          <tbody>
                            {myLines.map((line, idx) => {
                              const checked = !!localChecked[line.id] || !!myReceipt;
                              return (
                                <tr key={line.id} className={`border-t border-gray-50 ${checked ? 'opacity-50' : 'hover:bg-gray-50/50'}`}>
                                  <td className={`px-4 py-2.5 font-medium ${checked ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                                    {line.item_name}
                                    <div className="text-xs text-gray-400 font-normal sm:hidden">{line.unit}</div>
                                  </td>
                                  <td className="px-4 py-2.5 text-xs text-gray-500 hidden sm:table-cell">{line.unit}</td>
                                  <td className="px-4 py-2.5 text-center">
                                    <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-md bg-[#1B5E20]/10 text-[#1B5E20] font-bold text-sm">
                                      {line.delivery_qty}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 text-center">
                                    {!myReceipt && (
                                      <button
                                        onClick={() => setLocalChecked(prev => ({ ...prev, [line.id]: !prev[line.id] }))}
                                        className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors mx-auto ${
                                          localChecked[line.id]
                                            ? 'bg-[#1B5E20] border-[#1B5E20]'
                                            : 'border-gray-300 hover:border-[#1B5E20]'
                                        }`}
                                      >
                                        {localChecked[line.id] && <CheckCircle2 size={13} className="text-white" />}
                                      </button>
                                    )}
                                    {myReceipt && <CheckCircle2 size={16} className="text-[#1B5E20] mx-auto" />}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {!myReceipt && (
                        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
                          <span className="text-sm text-gray-500">
                            <span className="font-semibold text-gray-800">{myCheckedCount}</span> / {myLines.length} items confirmed
                          </span>
                          <button
                            onClick={handleConfirmReceipt}
                            disabled={submittingReceipt}
                            className="flex items-center gap-2 bg-[#1B5E20] text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[#2E7D32] transition-colors disabled:opacity-50"
                          >
                            <CheckCircle2 size={15} />
                            {submittingReceipt ? 'Saving…' : 'Delivery Received'}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Admin receipt overview ── */}
          {isAdmin && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">Store Receipts</h2>
              <div className="space-y-3">
                {STORES.map(store => {
                  const receipt = receiptByLocation(store);
                  const storeLines = lines.filter(l => l.location_name === store);
                  return (
                    <div key={store} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${receipt ? 'bg-[#1B5E20]' : 'bg-gray-200'}`} />
                        <span className="text-sm font-medium text-gray-800">{store}</span>
                        <span className="text-xs text-gray-400">{storeLines.length} items</span>
                      </div>
                      {receipt ? (
                        <div className="text-right">
                          <p className="text-xs font-semibold text-green-700">Confirmed {fmt(receipt.received_at)}</p>
                          <p className="text-xs text-gray-400">
                            {receipt.items_confirmed_count != null ? `${receipt.items_confirmed_count} items` : ''}
                            {receipt.received_by ? ` · ${profileMap[receipt.received_by] ?? '—'}` : ''}
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400 flex items-center gap-1">
                          <Clock size={12} /> Awaiting
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
