'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  Package, Truck, CheckCircle2, Clock, AlertTriangle, ChevronDown, ChevronUp, Trash2, RotateCcw, XCircle,
} from 'lucide-react';
import { useT } from '@/lib/i18n';

/* ─── Types ─────────────────────────────────────────────────────────────── */
type DeliverySnapshot = {
  inventories: Record<string, { submitted_at: string }>;
  snapped_at: string;
};

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
  delivery_finished_at: string | null;
  delivery_snapshot: DeliverySnapshot | null;
  lists_checked_at: string | null;
  lists_checked_by: string | null;
  list_confirmed_eschborn_at: string | null;
  list_confirmed_taunus_at: string | null;
  list_confirmed_westend_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  inventory_overrides: Record<string, string> | null;
  store_packing_finished_at: Record<string, string> | null;
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

type InventorySub = {
  location_name: string;
  submitted_at: string;
};

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

const DELIVERY_DAYS = [1, 2, 3, 5]; // Mon Tue Wed Fri

/** Next upcoming delivery date string (YYYY-MM-DD) where cutoff (14:00) is still in the future */
function getNextDeliveryDate(): string {
  const now = new Date();
  for (let i = 0; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    if (DELIVERY_DAYS.includes(d.getDay())) {
      // Check cutoff is still ahead
      const cutoff = new Date(
        d.getFullYear(), d.getMonth(), d.getDate(), 14, 0, 0
      );
      if (cutoff > now) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
    }
  }
  // Fallback: first delivery day found regardless of cutoff
  const d = new Date(now);
  for (let i = 1; i <= 7; i++) {
    d.setDate(now.getDate() + i);
    if (DELIVERY_DAYS.includes(d.getDay())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  }
  return now.toISOString().slice(0, 10);
}

/** Returns the delivery cutoff (14:00 on delivery_date) as a Date */
function deliveryCutoff(deliveryDate: string): Date {
  return new Date(deliveryDate + 'T14:00:00');
}

/** 'green' = within 24 h of cutoff, 'amber' = within 48 h, 'red' = older / missing / submitted after cutoff */
function inventoryFreshness(submittedAt: string | null, cutoffDate: string): 'green' | 'amber' | 'red' {
  if (!submittedAt) return 'red';
  const cutoff = deliveryCutoff(cutoffDate).getTime();
  const submitted = new Date(submittedAt).getTime();
  if (submitted >= cutoff) return 'red'; // submitted after cutoff — irrelevant for this delivery
  const diff = cutoff - submitted; // ms before cutoff
  if (diff <= 24 * 3600 * 1000) return 'green';
  if (diff <= 48 * 3600 * 1000) return 'amber';
  return 'red';
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/* ─── Step row shell ─────────────────────────────────────────────────────── */
function StepRow({
  step, accent, title, meta, timeLeft, timeRight, timeMid, status,
  expandable, expanded, onToggle, children,
  onReset, resetting, pendingReset, onResetClick,
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
  onReset?: () => void;
  resetting?: boolean;
  pendingReset?: boolean;
  onResetClick?: () => void;
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

        {/* Status + Reset — right side */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
          <div className="flex-shrink-0">{status}</div>

          {/* Reset */}
          {onReset && (
            <div className="flex-shrink-0" onClick={e => e.stopPropagation()}>
              {pendingReset ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400 whitespace-nowrap">Reset?</span>
                  <button
                    onClick={onReset}
                    disabled={resetting}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {resetting ? '…' : 'Yes'}
                  </button>
                  <button
                    onClick={onResetClick}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={onResetClick}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-orange-400 hover:bg-orange-500 transition-colors"
                >
                  Reset
                </button>
              )}
            </div>
          )}
        </div>

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
  const { t } = useT();
  const [selectedRunId, setSelectedRunId] = useState<string | null>('upcoming');
  const [localChecked, setLocalChecked] = useState<Record<string, boolean>>({});
  const [localNotes, setLocalNotes] = useState<Record<string, string>>({});
  const [expandedStore, setExpandedStore] = useState<Store | null>(null);
  const [submittingStore, setSubmittingStore] = useState<Store | null>(null);

  /* ── Reset state ── */
  const [pendingReset, setPendingReset] = useState<string | null>(null); // step key awaiting confirm
  const [resettingStep, setResettingStep] = useState<string | null>(null);

  /* ── Trash state ── */
  const [showTrash, setShowTrash] = useState(false);
  const [confirmPermDeleteId, setConfirmPermDeleteId] = useState<string | null>(null);
  const [pendingTrashId, setPendingTrashId] = useState<string | null>(null);

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
        .select('*')
        .is('deleted_at', null)
        .order('delivery_date', { ascending: false })
        .limit(30);
      return (data ?? []) as Run[];
    },
  });

  /* ── Trash ── */
  const { data: trashRuns = [] } = useQuery<Run[]>({
    queryKey: ['delivery-runs-trash'],
    enabled: isAdmin,
    queryFn: async () => {
      const { data } = await supabase
        .from('delivery_runs')
        .select('*')
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false });
      return (data ?? []) as Run[];
    },
  });

  const activeRun = useMemo<Run | null>(() => {
    if (!runs.length) return null;
    if (selectedRunId === 'upcoming') {
      // Auto-select the run for the upcoming delivery date if it already exists in DB
      const upcomingDate = getNextDeliveryDate();
      return runs.find(r => r.delivery_date === upcomingDate) ?? null;
    }
    if (selectedRunId) return runs.find(r => r.id === selectedRunId) ?? null;
    // Default: most recent past run (cutoff already passed), sorted desc so [0] is latest
    const now = new Date();
    const pastRuns = runs.filter(r => deliveryCutoff(r.delivery_date) <= now || !!r.delivery_finished_at);
    return pastRuns[0] ?? null;
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

  /* ── Inventory submissions — relative to active run's date (upcoming) or next delivery (fallback) ── */
  const invSubsDate = activeRun?.delivery_finished_at ? null : (activeRun?.delivery_date ?? getNextDeliveryDate());
  const { data: invSubs = [] } = useQuery<InventorySub[]>({
    queryKey: ['dr-inv-subs', invSubsDate],
    queryFn: async () => {
      // Latest submission per store submitted BEFORE the cutoff of this run
      const cutoffIso = deliveryCutoff(invSubsDate!).toISOString();
      const results = await Promise.all(
        STORES.map(store =>
          supabase
            .from('inventory_submissions')
            .select('location_name, submitted_at')
            .eq('location_name', store)
            .lt('submitted_at', cutoffIso)
            .order('submitted_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        )
      );
      return results
        .map(r => r.data)
        .filter(Boolean) as InventorySub[];
    },
    enabled: !!invSubsDate,
    staleTime: 60_000,
  });

  const invSubFor = (store: Store) => invSubs.find(s => s.location_name === store) ?? null;

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

  /* ── Reset a step ── */
  const resetStep = async (stepKey: string, updates: Record<string, null | undefined>) => {
    if (!activeRun) return;
    setResettingStep(stepKey);
    try {
      await supabase.from('delivery_runs').update(updates).eq('id', activeRun.id);
      qc.invalidateQueries({ queryKey: ['delivery-runs-list'] });
      qc.invalidateQueries({ queryKey: ['dr-lines', activeRun.id] });
    } finally {
      setResettingStep(null);
      setPendingReset(null);
    }
  };

  const resetReceipt = async (store: Store) => {
    if (!activeRun) return;
    setResettingStep(`receipt-${store}`);
    try {
      await supabase.from('store_delivery_receipts')
        .delete()
        .eq('run_id', activeRun.id)
        .eq('location_name', store);
      qc.invalidateQueries({ queryKey: ['dr-receipts', activeRun.id] });
    } finally {
      setResettingStep(null);
      setPendingReset(null);
    }
  };

  /* ── Confirm / unconfirm inventory for a store (override freshness check) ── */
  const confirmInventory = useMutation({
    mutationFn: async (store: Store) => {
      if (!activeRun) throw new Error('No active run');
      const { data: { user } } = await supabase.auth.getUser();
      const current = activeRun.inventory_overrides ?? {};
      const { error } = await supabase.from('delivery_runs')
        .update({ inventory_overrides: { ...current, [store]: new Date().toISOString(), _confirmed_by: user?.id ?? null } })
        .eq('id', activeRun.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delivery-runs-list'] }),
  });

  const unconfirmInventory = useMutation({
    mutationFn: async (store: Store) => {
      if (!activeRun) throw new Error('No active run');
      const current = { ...(activeRun.inventory_overrides ?? {}) };
      delete current[store];
      const { error } = await supabase.from('delivery_runs')
        .update({ inventory_overrides: current })
        .eq('id', activeRun.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delivery-runs-list'] }),
  });

  /* ── Soft-delete a run → moves to trash ── */
  const deleteRun = useMutation({
    mutationFn: async (runId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('delivery_runs')
        .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null })
        .eq('id', runId);
      if (error) throw error;
    },
    onSuccess: (_, runId) => {
      if (selectedRunId === runId) setSelectedRunId(null);
      qc.invalidateQueries({ queryKey: ['delivery-runs-list'] });
      qc.invalidateQueries({ queryKey: ['delivery-runs-trash'] });
    },
  });

  /* ── Restore from trash ── */
  const restoreRun = useMutation({
    mutationFn: async (runId: string) => {
      const { error } = await supabase.from('delivery_runs')
        .update({ deleted_at: null, deleted_by: null })
        .eq('id', runId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delivery-runs-list'] });
      qc.invalidateQueries({ queryKey: ['delivery-runs-trash'] });
    },
  });

  /* ── Permanent delete (from trash only) ── */
  const permDeleteRun = useMutation({
    mutationFn: async (runId: string) => {
      await supabase.from('delivery_run_lines').delete().eq('run_id', runId);
      await supabase.from('store_delivery_receipts').delete().eq('run_id', runId);
      const { error } = await supabase.from('delivery_runs').delete().eq('id', runId);
      if (error) throw error;
    },
    onSuccess: () => {
      setConfirmPermDeleteId(null);
      qc.invalidateQueries({ queryKey: ['delivery-runs-trash'] });
    },
  });

  const makeResetProps = (stepKey: string, onReset: () => void) => ({
    onReset: isAdmin ? onReset : undefined,
    resetting: resettingStep === stepKey,
    pendingReset: pendingReset === stepKey,
    onResetClick: isAdmin
      ? () => setPendingReset(prev => prev === stepKey ? null : stepKey)
      : undefined,
  });

  /* ─── Render ─────────────────────────────────────────────────────────── */
  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('delivery.reports')}</h1>
        <p className="text-sm text-gray-500 mt-0.5">Step-by-step log of each delivery run</p>
      </div>

      {/* ── Run selector — split Upcoming / Past ── */}
      {(() => {
        const now = new Date();
        // Next delivery date from the calendar (independent of what runs exist in DB)
        const nextDate = getNextDeliveryDate();
        const nextRun  = runs.find(r => r.delivery_date === nextDate) ?? null;

        // Past = all runs whose 14:00 cutoff has already passed, or are explicitly finished
        const past = runs.filter(r => deliveryCutoff(r.delivery_date) <= now || !!r.delivery_finished_at);

        // Upcoming button — always anchored to the real next delivery date
        const upcomingIsActive = nextRun ? activeRun?.id === nextRun.id : selectedRunId === 'upcoming';

        const PastBtn = ({ run: r }: { run: Run }) => {
          const isActive = activeRun?.id === r.id;
          const isPendingTrash = pendingTrashId === r.id;
          return (
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => { setSelectedRunId(r.id); setLocalChecked({}); setLocalNotes({}); setPendingTrashId(null); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-gray-700 text-white border-gray-700'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                }`}
              >
                {fmtDate(r.delivery_date)}
                {r.delivery_finished_at && <span className="opacity-60">✓</span>}
              </button>
              {isAdmin && (
                isPendingTrash ? (
                  <div className="flex items-center gap-1 ml-1">
                    <span className="text-xs text-gray-400 whitespace-nowrap">Move to trash?</span>
                    <button
                      onClick={() => { deleteRun.mutate(r.id); setPendingTrashId(null); }}
                      disabled={deleteRun.isPending}
                      className="px-2 py-1 rounded text-xs font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                    >Yes</button>
                    <button
                      onClick={() => setPendingTrashId(null)}
                      className="px-2 py-1 rounded text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                    >No</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setPendingTrashId(r.id)}
                    disabled={deleteRun.isPending}
                    className="p-1 rounded text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors disabled:opacity-40"
                    title="Move to trash"
                  >
                    <Trash2 size={12} />
                  </button>
                )
              )}
            </div>
          );
        };

        return (
          <div className="mb-6 space-y-3">
            {/* Always show the single next delivery date */}
            <div>
              <p className="text-xs font-semibold text-[#1B5E20] uppercase tracking-wider mb-2">Upcoming</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    setSelectedRunId(nextRun ? nextRun.id : 'upcoming');
                    setLocalChecked({});
                    setLocalNotes({});
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                    upcomingIsActive
                      ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                      : 'bg-white text-[#1B5E20] border-[#1B5E20]/30 hover:border-[#1B5E20]'
                  }`}
                >
                  {fmtDate(nextDate)}
                </button>
              </div>
            </div>
            {(past.length > 0 || isAdmin) && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Past — snapshot</p>
                  {isAdmin && (
                    <button
                      onClick={() => setShowTrash(v => !v)}
                      className={`relative flex items-center gap-1 px-2 py-0.5 rounded-md text-xs transition-colors ${showTrash ? 'bg-red-100 text-red-600' : 'text-gray-400 hover:text-red-400 hover:bg-red-50'}`}
                      title="Trash bin"
                    >
                      <Trash2 size={12} />
                      {trashRuns.length > 0 && (
                        <span className="bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                          {trashRuns.length}
                        </span>
                      )}
                    </button>
                  )}
                </div>
                {past.length > 0 && (
                  <div className="flex flex-wrap gap-2">{past.map(r => <PastBtn key={r.id} run={r} />)}</div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Trash panel ── */}
      {isAdmin && showTrash && (
        <div className="mb-6 border border-red-100 rounded-xl bg-red-50/40 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-red-100 bg-red-50">
            <Trash2 size={14} className="text-red-400" />
            <p className="text-xs font-semibold text-red-600 uppercase tracking-wider flex-1">Trash</p>
            <p className="text-xs text-red-400">{trashRuns.length} run{trashRuns.length !== 1 ? 's' : ''}</p>
          </div>
          {trashRuns.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">Trash is empty</p>
          ) : (
            <div className="divide-y divide-red-100">
              {trashRuns.map(r => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700">{fmtDate(r.delivery_date)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Deleted {r.deleted_at ? fmtDateTime(r.deleted_at) : '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Restore */}
                    <button
                      onClick={() => restoreRun.mutate(r.id)}
                      disabled={restoreRun.isPending || permDeleteRun.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40"
                    >
                      <RotateCcw size={12} /> Restore
                    </button>
                    {/* Permanent delete — with inline confirm */}
                    {confirmPermDeleteId === r.id ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-400 whitespace-nowrap">Delete forever?</span>
                        <button
                          onClick={() => permDeleteRun.mutate(r.id)}
                          disabled={permDeleteRun.isPending}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                        >
                          {permDeleteRun.isPending ? '…' : 'Yes'}
                        </button>
                        <button
                          onClick={() => setConfirmPermDeleteId(null)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmPermDeleteId(r.id)}
                        disabled={restoreRun.isPending || permDeleteRun.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-200 bg-white text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                      >
                        <XCircle size={12} /> Delete forever
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Empty state ── */}
      {!activeRun && (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center text-gray-400 text-sm space-y-1">
          <Package size={32} className="mx-auto text-gray-200 mb-3" />
          {selectedRunId === 'upcoming'
            ? <>
                <p className="font-medium text-gray-500">No delivery list generated yet</p>
                <p className="text-xs text-gray-400">Once inventories are in, go to <strong>List Confirmation</strong> and click <strong>Generate List</strong>.</p>
              </>
            : <p>No delivery runs found yet.</p>
          }
        </div>
      )}

      {/* ── Inventories row ── */}
      {/* Always shown: past runs use snapshot, upcoming runs use live data */}
      {activeRun && (() => {
            const snapshot = activeRun.delivery_snapshot ?? null;
            const isPastRun = !!activeRun.delivery_finished_at;
            const overrides = activeRun.inventory_overrides ?? {};
            const evalDate = activeRun.delivery_date;
            const cutoff = deliveryCutoff(evalDate);
            const canOverride = isAdmin && !isPastRun;

            const getSubmittedAt = (store: Store): string | null => {
              if (isPastRun && snapshot) return snapshot.inventories[store]?.submitted_at ?? null;
              return invSubFor(store)?.submitted_at ?? null;
            };

            // Effective freshness: override → always green
            const effectiveFreshness = (store: Store) =>
              overrides[store] ? 'green' : inventoryFreshness(getSubmittedAt(store), evalDate);

            const allGreen = STORES.every(s => effectiveFreshness(s) === 'green');
            const anyRed   = STORES.some(s  => effectiveFreshness(s) === 'red');
            const accent   = allGreen ? 'green' : 'amber';
            const statusNode = allGreen
              ? <GreenBadge label="All confirmed" />
              : anyRed ? <AmberBadge label="Some missing / late" /> : <AmberBadge label="Some late" />;

            return (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex items-center gap-4 px-5 py-4 flex-wrap">
                  {/* Step number */}
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${accent === 'green' ? 'bg-[#1B5E20]' : 'bg-amber-500'}`}>
                    <span className="text-white text-xs font-bold">1</span>
                  </div>
                  {/* Title */}
                  <div className="w-36 flex-shrink-0">
                    <p className="text-sm font-semibold text-gray-900">Inventories</p>
                    <p className="text-xs text-gray-400 truncate">
                      {isPastRun
                        ? <>snapshot · {cutoff.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</>
                        : <>{cutoff.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · cutoff {cutoff.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</>
                      }
                    </p>
                  </div>
                  {/* Store ticks */}
                  <div className="flex items-center gap-4 flex-1 min-w-0 flex-wrap">
                    {STORES.map(store => {
                      const submittedAt = getSubmittedAt(store);
                      const isOverridden = !!overrides[store];
                      const freshness = effectiveFreshness(store);
                      const tickColor = freshness === 'green'
                        ? 'text-green-600 bg-green-50 border-green-200'
                        : freshness === 'amber'
                        ? 'text-amber-600 bg-amber-50 border-amber-200'
                        : 'text-gray-400 bg-gray-50 border-gray-200';
                      const icon = freshness === 'green'
                        ? <CheckCircle2 size={13} />
                        : freshness === 'amber'
                        ? <AlertTriangle size={13} />
                        : <Clock size={13} />;
                      return (
                        <div key={store} className={`inline-flex flex-col items-start gap-0.5 border rounded-lg px-2.5 py-1.5 ${tickColor}`}>
                          <div className="flex items-center gap-1 text-xs font-semibold">
                            {icon} {store}
                            {isOverridden && (
                              <span className="ml-1 text-[10px] font-normal opacity-70 italic">manually confirmed</span>
                            )}
                          </div>
                          {submittedAt
                            ? <span className="text-xs opacity-70 font-mono">{fmtDateTime(submittedAt)}</span>
                            : <span className="text-xs opacity-50">No submission</span>
                          }
                          {/* Admin actions */}
                          {canOverride && (
                            isOverridden ? (
                              <button
                                onClick={() => unconfirmInventory.mutate(store)}
                                disabled={unconfirmInventory.isPending}
                                className="mt-1 text-[10px] text-green-500 hover:text-green-700 underline leading-none disabled:opacity-50"
                              >
                                undo
                              </button>
                            ) : freshness !== 'green' ? (
                              <button
                                onClick={() => confirmInventory.mutate(store)}
                                disabled={confirmInventory.isPending}
                                className="mt-1 text-[10px] text-amber-600 hover:text-amber-800 underline leading-none disabled:opacity-50"
                              >
                                confirm for this delivery
                              </button>
                            ) : null
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* Status */}
                  <div className="flex-shrink-0 ml-auto">{statusNode}</div>
                </div>
              </div>
            );
      })()}

      {/* ── Step rows (historical run) ── */}
      {activeRun && (
        <div className="space-y-3 mt-3">

          {/* Snapshot notice for past runs */}
          {activeRun.delivery_finished_at && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-500">
              <CheckCircle2 size={13} className="text-gray-400 flex-shrink-0" />
              <span>
                Delivery completed — this is a <strong>saved snapshot</strong> from {fmtDateTime(activeRun.delivery_finished_at)}.
                {activeRun.delivery_snapshot
                  ? ` Inventory data captured at finish.`
                  : ` Inventory snapshot not available (delivery finished before this feature was added).`
                }
              </span>
            </div>
          )}

          {/* ── Row 2: Delivery Lists Checked ── */}
          {(() => {
            const allListsConfirmed =
              !!activeRun.list_confirmed_eschborn_at &&
              !!activeRun.list_confirmed_taunus_at &&
              !!activeRun.list_confirmed_westend_at;
            const checked = !!activeRun.lists_checked_at || allListsConfirmed;
            const checkedAt = activeRun.lists_checked_at
              ?? (allListsConfirmed
                  ? [
                      activeRun.list_confirmed_eschborn_at,
                      activeRun.list_confirmed_taunus_at,
                      activeRun.list_confirmed_westend_at,
                    ].filter(Boolean).sort().at(-1) ?? null
                  : null);
            const byName = activeRun.lists_checked_by ? (profileMap[activeRun.lists_checked_by] ?? '—') : undefined;
            const accent = checked ? 'green' : 'gray';
            const statusNode = checked
              ? <GreenBadge label="Confirmed" />
              : <GrayBadge label="Pending" />;

            return (
              <StepRow
                step={2}
                accent={accent}
                title="Lists Checked"
                meta={byName}
                timeLeft={checked ? fmt(checkedAt) : undefined}
                status={statusNode}
                {...(checked ? makeResetProps('lists-checked', () => resetStep('lists-checked', { lists_checked_at: null, lists_checked_by: null })) : {})}
              >
                {null}
              </StepRow>
            );
          })()}

          {/* ── Row 3: Packing Started ── */}
          {(() => {
            const started = !!activeRun.packing_started_at;
            const byName = activeRun.packed_by ? (profileMap[activeRun.packed_by] ?? '—') : undefined;
            const accent = started ? 'green' : 'gray';
            const statusNode = started
              ? <GreenBadge label="Started" />
              : <GrayBadge label="Not started" />;

            return (
              <StepRow
                step={3}
                accent={accent}
                title="Packing Started"
                meta={byName}
                timeLeft={fmt(activeRun.packing_started_at)}
                status={statusNode}
                {...(started ? makeResetProps('packing-started', () => resetStep('packing-started', { packing_started_at: null, packed_by: null })) : {})}
              >
                {null}
              </StepRow>
            );
          })()}

          {/* ── Row 3: Packing Finished ── */}
          {(() => {
            const DELIVERY_STORES = ['Eschborn', 'Taunus', 'Westend'];
            const storeTs = activeRun.store_packing_finished_at ?? {};
            const allStoresPacked = DELIVERY_STORES.every(s => !!storeTs[s]);
            // If store-level packing data exists, it is the authoritative source —
            // packing_finished_at may be stale from a previous cycle that was undone.
            const hasStoreData = Object.keys(storeTs).length > 0;
            const done = hasStoreData ? allStoresPacked : !!activeRun.packing_finished_at;

            // Timestamp: latest store pack time (live) or legacy packing_finished_at
            const effectiveFinishedAt: string | null = allStoresPacked
              ? DELIVERY_STORES.map(s => storeTs[s]).filter(Boolean).sort().at(-1) ?? null
              : activeRun.packing_finished_at;

            const accent = done ? 'green' : 'gray';

            const statusNode: React.ReactNode = done
              ? <GreenBadge label="Complete" />
              : <GrayBadge label="In progress" />;

            return (
              <StepRow
                step={4}
                accent={accent as 'green' | 'amber' | 'gray'}
                title="Packing Finished"
                timeLeft={done ? fmt(effectiveFinishedAt) : undefined}
                status={statusNode}
                {...(done ? makeResetProps('packing-finished', () => resetStep('packing-finished', { packing_finished_at: null, packing_duration_seconds: null, items_packed_count: null })) : {})}
              >
                {null}
              </StepRow>
            );
          })()}

          {/* ── Row 4: Delivery Started ── */}
          {(() => {
            const started = !!activeRun.delivery_started_at;
            const byName = activeRun.delivery_started_by ? (profileMap[activeRun.delivery_started_by] ?? '—') : undefined;
            const accent = started ? 'green' : 'gray';
            const statusNode = started
              ? <GreenBadge label="Departed ZK" />
              : <GrayBadge label="Not started" />;

            return (
              <StepRow
                step={5}
                accent={accent}
                title="Delivery Started"
                meta={byName}
                timeLeft={fmt(activeRun.delivery_started_at)}
                status={statusNode}
                {...(started ? makeResetProps('delivery-started', () => resetStep('delivery-started', { delivery_started_at: null, delivery_started_by: null })) : {})}
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
                step={i + 6}
                accent={accent}
                title={store}
                meta={receipt?.received_by ? profileMap[receipt.received_by] : undefined}
                timeLeft={receipt ? fmt(receipt.received_at) : undefined}
                status={statusNode}
                expandable={canExpand || canInteract}
                expanded={isExpanded}
                onToggle={() => setExpandedStore(prev => prev === store ? null : store)}
                {...(receipt ? makeResetProps(`receipt-${store}`, () => resetReceipt(store)) : {})}
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

          {/* ── Row 7: Delivery Finished ── */}
          {(() => {
            const finished = !!activeRun.delivery_finished_at;
            const accent = finished ? 'green' : 'gray';
            const statusNode = finished
              ? <GreenBadge label="Returned to ZK" />
              : <GrayBadge label="Awaiting" />;

            return (
              <StepRow
                step={9}
                accent={accent}
                title="Delivery Finished"
                timeLeft={fmt(activeRun.delivery_finished_at)}
                status={statusNode}
                {...(finished ? makeResetProps('delivery-finished', () => resetStep('delivery-finished', { delivery_finished_at: null, delivery_snapshot: null })) : {})}
              >
                {null}
              </StepRow>
            );
          })()}

        </div>
      )}
    </div>
  );
}
