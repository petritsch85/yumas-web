'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  Package, Truck, CheckCircle2, Clock, AlertTriangle, ChevronDown, ChevronUp,
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
  notes: string | null;
};

type ProfileMap = Record<string, string>;

/* ─── Constants ──────────────────────────────────────────────────────────── */
const STORES = ['Eschborn', 'Taunus', 'Westend'] as const;
type Store = (typeof STORES)[number];

/* ─── Helpers ─────────────────────────────────────────────────────────────  */
function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

function fmtDuration(seconds: number | null): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m} min`;
  return `${m}m ${s}s`;
}

/* ─── Step row shell ─────────────────────────────────────────────────────── */
function StepRow({
  step, accent, title, meta, timeLeft, timeRight, timeMid, status, expandable, expanded, onToggle, children,
}: {
  step: number;
  accent: 'green' | 'blue' | 'amber' | 'gray';
  title: string;
  meta?: string;
  timeLeft?: string;
  timeRight?: string;
  timeMid?: string;
  status: React.ReactNode;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  children?: React.ReactNode;
}) {
  const accentBg = accent === 'green' ? 'bg-[#1B5E20]'
    : accent === 'blue' ? 'bg-blue-600'
    : accent === 'amber' ? 'bg-amber-500'
    : 'bg-gray-300';

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div
        className={`flex items-center gap-4 px-5 py-4 ${expandable ? 'cursor-pointer hover:bg-gray-50/60 transition-colors' : ''}`}
        onClick={expandable ? onToggle : undefined}
      >
        {/* Step number */}
        <div className={`w-7 h-7 rounded-full ${accentBg} flex items-center justify-center flex-shrink-0`}>
          <span className="text-white text-xs font-bold">{step}</span>
        </div>

        {/* Title + meta */}
        <div className="w-28 flex-shrink-0">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          {meta && <p className="text-xs text-gray-400 truncate">{meta}</p>}
        </div>

        {/* Timestamps */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {timeLeft !== undefined && (
            <span className="text-xs font-mono text-gray-600 whitespace-nowrap">{timeLeft}</span>
          )}
          {timeLeft !== undefined && timeRight !== undefined && (
            <span className="text-gray-300 text-xs">→</span>
          )}
          {timeRight !== undefined && (
            <span className="text-xs font-mono text-gray-600 whitespace-nowrap">{timeRight}</span>
          )}
          {timeMid && (
            <span className="text-xs text-gray-400 ml-1 whitespace-nowrap">{timeMid}</span>
          )}
        </div>

        {/* Status */}
        <div className="flex-shrink-0 ml-auto">{status}</div>

        {/* Chevron */}
        {expandable && (
          <div className="flex-shrink-0 text-gray-400">
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </div>
        )}
      </div>

      {/* Expanded content */}
      {expandable && expanded && children && (
        <div className="border-t border-gray-100">{children}</div>
      )}
    </div>
  );
}

/* ─── Status badges ──────────────────────────────────────────────────────── */
function GreenBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 border border-green-200 text-xs font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap">
      <CheckCircle2 size={12} /> {label}
    </span>
  );
}

function AmberBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap">
      <AlertTriangle size={12} /> {label}
    </span>
  );
}

function GrayBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 bg-gray-50 text-gray-400 border border-gray-200 text-xs font-medium px-2.5 py-1 rounded-lg whitespace-nowrap">
      <Clock size={12} /> {label}
    </span>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────────── */
export default function DeliveryReportsPage() {
  const qc = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [localChecked, setLocalChecked] = useState<Record<string, boolean>>({});
  const [localNotes, setLocalNotes] = useState<Record<string, string>>({});
  const [expandedStore, setExpandedStore] = useState<Store | null>(null);
  const [submittingStore, setSubmittingStore] = useState<Store | null>(null);

  /* ── Profile ── */
  const { data: profile } = useQuery({
    queryKey: ['dr-profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from('profiles').select('*, location:locations(name)').eq('id', user.id).single();
      return data as {
        id: string; full_name: string; role: string;
        location_id: string | null; location?: { name: string } | null;
      } | null;
    },
  });

  const myLocationName = profile?.location?.name ?? null;
  const isAdmin = profile?.role === 'admin' || profile?.role === 'manager';

  /* ── Runs ── */
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

  const activeRun = useMemo<Run | null>(() => {
    if (!runs.length) return null;
    if (selectedRunId) return runs.find(r => r.id === selectedRunId) ?? runs[0];
    return runs[0];
  }, [runs, selectedRunId]);

  /* ── Lines ── */
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

  /* ── Receipts ── */
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

  /* ── Profile map ── */
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

  /* ── Submit receipt ── */
  const submitReceipt = useMutation({
    mutationFn: async ({ locationName, count, notes }: { locationName: string; count: number; notes: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('store_delivery_receipts').upsert({
        run_id: activeRun!.id,
        location_name: locationName,
        received_at: new Date().toISOString(),
        received_by: user?.id ?? null,
        items_confirmed_count: count,
        notes: notes.trim() || null,
      }, { onConflict: 'run_id,location_name' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dr-receipts', activeRun?.id] });
    },
  });

  /* ── Derived values ── */
  const totalLines = lines.length;
  const packedCount = activeRun?.items_packed_count ?? null;
  const missingPacked = (packedCount !== null && totalLines > 0) ? Math.max(0, totalLines - packedCount) : 0;

  const lastReceiptAt = receipts.length > 0
    ? receipts.reduce((latest, r) => r.received_at > latest ? r.received_at : latest, receipts[0].received_at)
    : null;
  const storesReceived = STORES.filter(s => receipts.some(r => r.location_name === s)).length;

  const receiptFor = (store: Store) => receipts.find(r => r.location_name === store) ?? null;
  const linesFor = (store: Store) => lines.filter(l => l.location_name === store);

  const checkedForStore = (store: Store) =>
    linesFor(store).filter(l => localChecked[l.id]).length;

  const handleConfirm = async (store: Store) => {
    setSubmittingStore(store);
    try {
      await submitReceipt.mutateAsync({
        locationName: store,
        count: checkedForStore(store),
        notes: localNotes[store] ?? '',
      });
      setLocalChecked({});
    } finally {
      setSubmittingStore(null);
    }
  };

  /* ─── Render ─────────────────────────────────────────────────────────── */
  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Delivery Reports</h1>
        <p className="text-sm text-gray-500 mt-0.5">Step-by-step log of each delivery run</p>
      </div>

      {/* ── Run selector ── */}
      {runs.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {runs.map(run => (
            <button
              key={run.id}
              onClick={() => { setSelectedRunId(run.id); setLocalChecked({}); setLocalNotes({}); }}
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

      {/* ── Empty state ── */}
      {!activeRun && (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center text-gray-400 text-sm">
          <Package size={32} className="mx-auto text-gray-200 mb-3" />
          No delivery runs found yet.
        </div>
      )}

      {/* ── Step rows ── */}
      {activeRun && (
        <div className="space-y-3">

          {/* ── Row 1: Packing ── */}
          {(() => {
            const done = !!activeRun.packing_finished_at;
            const started = !!activeRun.packing_started_at;
            const duration = fmtDuration(activeRun.packing_duration_seconds);
            const byName = activeRun.packed_by ? (profileMap[activeRun.packed_by] ?? '—') : undefined;
            const accent = !started ? 'gray' : missingPacked > 0 ? 'amber' : done ? 'green' : 'amber';

            let statusNode: React.ReactNode;
            if (!started) {
              statusNode = <GrayBadge label="Not started" />;
            } else if (!done) {
              statusNode = <GrayBadge label="In progress" />;
            } else if (missingPacked > 0) {
              statusNode = <AmberBadge label={`${missingPacked} missing`} />;
            } else {
              statusNode = <GreenBadge label="All packed" />;
            }

            return (
              <StepRow
                step={1}
                accent={accent as 'green' | 'amber' | 'gray'}
                title="Packing"
                meta={byName}
                timeLeft={fmt(activeRun.packing_started_at)}
                timeRight={done ? fmt(activeRun.packing_finished_at) : undefined}
                timeMid={done && duration ? `· ${duration}` : undefined}
                status={statusNode}
              >
                {null}
              </StepRow>
            );
          })()}

          {/* ── Row 2: Delivery ── */}
          {(() => {
            const started = !!activeRun.delivery_started_at;
            const byName = activeRun.delivery_started_by ? (profileMap[activeRun.delivery_started_by] ?? '—') : undefined;
            const accent = !started ? 'gray' : storesReceived === STORES.length ? 'green' : 'blue';

            let statusNode: React.ReactNode;
            if (!started) {
              statusNode = <GrayBadge label="Not started" />;
            } else if (storesReceived === STORES.length) {
              statusNode = <GreenBadge label="All received" />;
            } else {
              statusNode = (
                <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 text-xs font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap">
                  <Truck size={12} /> {storesReceived}/{STORES.length} received
                </span>
              );
            }

            return (
              <StepRow
                step={2}
                accent={accent as 'green' | 'blue' | 'gray'}
                title="Delivery"
                meta={byName}
                timeLeft={fmt(activeRun.delivery_started_at)}
                timeRight={lastReceiptAt ? fmt(lastReceiptAt) : undefined}
                status={statusNode}
              >
                {null}
              </StepRow>
            );
          })()}

          {/* ── Rows 3-5: Store receipts ── */}
          {STORES.map((store, i) => {
            const storeLines = linesFor(store);
            const receipt = receiptFor(store);
            const isMyStore = myLocationName === store;
            const isExpanded = expandedStore === store;
            const deliveryStarted = !!activeRun.delivery_started_at;

            const confirmed = receipt?.items_confirmed_count ?? null;
            const total = storeLines.length;
            const missing = (confirmed !== null && total > 0) ? Math.max(0, total - confirmed) : 0;
            const checkedCount = checkedForStore(store);
            const note = receipt?.notes ?? '';
            const localNote = localNotes[store] ?? '';

            // Accent & status
            let accent: 'green' | 'amber' | 'gray' = 'gray';
            let statusNode: React.ReactNode;

            if (!receipt) {
              statusNode = <GrayBadge label="Awaiting" />;
            } else if (missing > 0) {
              accent = 'amber';
              statusNode = <AmberBadge label={`${missing} missing`} />;
            } else {
              accent = 'green';
              statusNode = <GreenBadge label={`${confirmed}/${total} confirmed`} />;
            }

            // Can interact: own store manager (non-admin) before delivery starts? No — only after delivery started
            const canInteract = isMyStore && !isAdmin && deliveryStarted;
            // Anyone can expand to view (admin/manager can read all, store managers see their own)
            const canExpand = (isAdmin && receipt != null) || canInteract || (isMyStore && receipt != null);

            return (
              <StepRow
                key={store}
                step={i + 3}
                accent={accent}
                title={store}
                meta={receipt?.received_by ? profileMap[receipt.received_by] : undefined}
                timeLeft={receipt ? fmt(receipt.received_at) : undefined}
                status={statusNode}
                expandable={canExpand || canInteract}
                expanded={isExpanded}
                onToggle={() => setExpandedStore(prev => prev === store ? null : store)}
              >
                <div className="px-5 py-4 space-y-4">

                  {/* Item checklist */}
                  {storeLines.length === 0 ? (
                    <p className="text-sm text-gray-400">No items scheduled for {store}</p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-gray-100">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Item</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide hidden sm:table-cell">Unit</th>
                            <th className="px-4 py-2.5 text-center text-xs font-semibold text-[#1B5E20] uppercase tracking-wide">Qty</th>
                            {(canInteract && !receipt) && (
                              <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-400 uppercase tracking-wide w-10">✓</th>
                            )}
                            {receipt && (
                              <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-400 uppercase tracking-wide w-10">✓</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {storeLines.map(line => {
                            const isChecked = !!localChecked[line.id];
                            const wasConfirmed = !!receipt;
                            return (
                              <tr key={line.id} className={`border-t border-gray-50 ${(isChecked || wasConfirmed) ? 'opacity-50' : 'hover:bg-gray-50/40'}`}>
                                <td className={`px-4 py-2.5 font-medium ${(isChecked || wasConfirmed) ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                                  {line.item_name}
                                  <div className="text-xs text-gray-400 font-normal sm:hidden">{line.unit}</div>
                                </td>
                                <td className="px-4 py-2.5 text-xs text-gray-500 hidden sm:table-cell">{line.unit}</td>
                                <td className="px-4 py-2.5 text-center">
                                  <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-md bg-[#1B5E20]/10 text-[#1B5E20] font-bold text-xs">
                                    {line.delivery_qty}
                                  </span>
                                </td>
                                {/* Interactive checkbox */}
                                {(canInteract && !receipt) && (
                                  <td className="px-4 py-2.5 text-center">
                                    <button
                                      onClick={() => setLocalChecked(prev => ({ ...prev, [line.id]: !prev[line.id] }))}
                                      className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors mx-auto ${
                                        isChecked ? 'bg-[#1B5E20] border-[#1B5E20]' : 'border-gray-300 hover:border-[#1B5E20]'
                                      }`}
                                    >
                                      {isChecked && <CheckCircle2 size={12} className="text-white" />}
                                    </button>
                                  </td>
                                )}
                                {/* Read-only confirmed state */}
                                {receipt && (
                                  <td className="px-4 py-2.5 text-center">
                                    <CheckCircle2 size={14} className="text-[#1B5E20] mx-auto" />
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Missing items banner */}
                  {receipt && missing > 0 && (
                    <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                      <AlertTriangle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-amber-700">
                        <span className="font-semibold">{missing} item{missing > 1 ? 's' : ''} missing</span> — {confirmed} of {total} items confirmed on arrival.
                      </p>
                    </div>
                  )}

                  {/* Note (editable pre-confirm, read-only post-confirm) */}
                  {canInteract && !receipt && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
                        Comment (optional)
                      </label>
                      <textarea
                        value={localNote}
                        onChange={e => setLocalNotes(prev => ({ ...prev, [store]: e.target.value }))}
                        placeholder="Note any issues, missing items, temperature concerns…"
                        rows={3}
                        className="w-full rounded-lg border border-gray-200 text-sm px-3 py-2 text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] resize-none"
                      />
                    </div>
                  )}

                  {/* Existing note (read-only) */}
                  {note && (
                    <div className="bg-gray-50 border border-gray-100 rounded-lg px-4 py-3">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Manager Note</p>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{note}</p>
                    </div>
                  )}

                  {/* Confirm button */}
                  {canInteract && !receipt && (
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-sm text-gray-500">
                        <span className="font-semibold text-gray-800">{checkedCount}</span> / {storeLines.length} items checked
                      </span>
                      <button
                        onClick={() => handleConfirm(store)}
                        disabled={submittingStore === store}
                        className="flex items-center gap-2 bg-[#1B5E20] text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[#2E7D32] transition-colors disabled:opacity-50"
                      >
                        <CheckCircle2 size={15} />
                        {submittingStore === store ? 'Saving…' : 'Delivery Received'}
                      </button>
                    </div>
                  )}

                </div>
              </StepRow>
            );
          })}

        </div>
      )}
    </div>
  );
}
