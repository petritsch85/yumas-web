'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { saveDraft, loadDraft, clearDraft } from '@/lib/draft-store';
import { enqueue, dequeueAll, removeFromQueue, pendingCount } from '@/lib/offline-queue';
import { ChevronLeft, Send, WifiOff, Wifi, RefreshCw, CheckCircle2, Timer, Play, Pause, Upload, X, FileSpreadsheet, AlertCircle, RotateCcw, Pencil } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useT } from '@/lib/i18n';

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

type Item    = { name: string; unit: string };
type Section = { title: string; data: Item[] };

type DbItem = {
  id: string; section: string; name: string; unit: string;
  sort_order: number; stores: string[];
  store_sort_orders: Record<string, number>;
};

type DbSection = {
  id: string; name: string; stores: string[]; sort_order: number;
};

const SECTION_ORDER_FALLBACK = ['Kühlhaus', 'Tiefkühler', 'Trockenware', 'Regale', 'Lager'];

/** True if the submission is still within the edit window (until 09:00 the next calendar day) */
function isEditable(submittedAt: string): boolean {
  const deadline = new Date(submittedAt);
  deadline.setDate(deadline.getDate() + 1);
  deadline.setHours(9, 0, 0, 0);
  return new Date() < deadline;
}

/* ─── Sync queue to Supabase ──────────────────────────────────────────────── */
async function syncPendingQueue(): Promise<number> {
  const items = await dequeueAll();
  let synced = 0;
  for (const item of items) {
    try {
      const { error } = await supabase.from('inventory_submissions').insert({
        location_id:      item.locationId,
        location_name:    item.locationName,
        submitted_by:     item.userId,
        submitted_at:     item.queuedAt,
        data:             item.data,
        comment:          item.comment,
        duration_seconds: item.durationSeconds ?? null,
      });
      if (!error) {
        await removeFromQueue(item.id!);
        synced++;
      }
    } catch { /* network still unavailable for this item */ }
  }
  return synced;
}

function normalise(s: string) {
  return s.toLowerCase().replace(/[\s\-_().]/g, '').trim();
}

/* ─── Upload Inventory Modal ─────────────────────────────────────────────── */
function UploadInventoryModal({
  locationId, locationName, onClose, onUploaded, sections,
}: {
  locationId:   string;
  locationName: string;
  onClose:      () => void;
  onUploaded:   () => void;
  sections:     Section[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const allItems = useMemo(
    () => sections.flatMap(s => s.data.map(i => ({ ...i, section: s.title }))),
    [sections],
  );

  const defaultDate = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };

  const [inventoryDate, setInventoryDate] = useState(defaultDate());
  const [inventoryTime, setInventoryTime] = useState('22:00');
  const [fileName, setFileName]           = useState('');
  const [matched, setMatched]             = useState<{ section: string; name: string; unit: string; quantity: number }[]>([]);
  const [unmatched, setUnmatched]         = useState<{ raw: string; qty: number }[]>([]);
  const [submitting, setSubmitting]       = useState(false);
  const [error, setError]                 = useState('');

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError('');

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data    = new Uint8Array(ev.target!.result as ArrayBuffer);
        const wb      = XLSX.read(data, { type: 'array' });
        const ws      = wb.Sheets[wb.SheetNames[0]];
        const rows    = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });

        const matchedItems: typeof matched = [];
        const unmatchedItems: typeof unmatched = [];

        for (const row of rows) {
          if (!Array.isArray(row) || row.length < 2) continue;
          const nameCandidates = row.filter(c => typeof c === 'string' && (c as string).trim().length > 1);
          const numCandidates  = row.filter(c => typeof c === 'number');
          if (!nameCandidates.length || !numCandidates.length) continue;

          const rawName = String(nameCandidates[0]).trim();
          const qty     = parseFloat(String(numCandidates[0]));
          if (isNaN(qty) || rawName.length < 2) continue;

          const normRaw = normalise(rawName);
          const found   = allItems.find(it => normalise(it.name) === normRaw)
                       ?? allItems.find(it => normalise(it.name).includes(normRaw) || normRaw.includes(normalise(it.name)));

          if (found) {
            const existing = matchedItems.findIndex(m => m.name === found.name);
            if (existing >= 0) matchedItems[existing].quantity = qty;
            else matchedItems.push({ section: found.section, name: found.name, unit: found.unit, quantity: qty });
          } else {
            unmatchedItems.push({ raw: rawName, qty });
          }
        }

        setMatched(matchedItems);
        setUnmatched(unmatchedItems);
        if (!matchedItems.length) setError('No items could be matched. Check the file format.');
      } catch {
        setError('Could not read the file. Please use .xls or .xlsx format.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSubmit = async () => {
    if (!matched.length) return;
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('Not logged in.'); setSubmitting(false); return; }

      const submittedAt = new Date(`${inventoryDate}T${inventoryTime}:00`).toISOString();

      const qtyMap: Record<string, number> = {};
      for (const m of matched) qtyMap[m.name] = m.quantity;

      // Build full data using the live DB sections — unmatched items get qty 0
      const data = sections.flatMap(section =>
        section.data.map(item => ({
          section:  section.title,
          name:     item.name,
          unit:     item.unit,
          quantity: qtyMap[item.name] ?? 0,
        }))
      );

      const { error: insertError } = await supabase.from('inventory_submissions').insert({
        location_id:   locationId,
        location_name: locationName,
        submitted_by:  user.id,
        submitted_at:  submittedAt,
        data,
        comment:       `Uploaded from Excel: ${fileName}`,
      });

      if (insertError) { setError(insertError.message); setSubmitting(false); return; }
      onUploaded();
      onClose();
    } catch (e: unknown) {
      setError((e as Error)?.message ?? 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Upload Inventory from Excel</h2>
            <p className="text-xs text-gray-400 mt-0.5">{locationName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Inventory Date &amp; Time</p>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-gray-400 mb-1 block">Date</label>
                <input type="date" value={inventoryDate} onChange={e => setInventoryDate(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30" />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Time</label>
                <input type="time" value={inventoryTime} onChange={e => setInventoryTime(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30" />
              </div>
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5">
              ⚠ Set this to the actual date of the inventory — e.g. 25 April, 22:00 for last week's closing count.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Excel File</p>
            <input ref={fileRef} type="file" accept=".xls,.xlsx" onChange={handleFile} className="hidden" />
            <button onClick={() => fileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-xl py-6 text-sm text-gray-400 hover:border-[#1B5E20]/40 hover:text-[#1B5E20] transition-colors">
              <FileSpreadsheet size={20} />
              {fileName ? fileName : 'Click to choose .xls / .xlsx file'}
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5 text-xs text-red-600">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {matched.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                ✓ {matched.length} items matched
              </p>
              <div className="rounded-xl border border-gray-100 overflow-hidden max-h-52 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-gray-400 font-medium">Item</th>
                      <th className="px-3 py-2 text-right text-gray-400 font-medium">Qty</th>
                      <th className="px-3 py-2 text-left text-gray-400 font-medium">Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matched.map(m => (
                      <tr key={m.name} className="border-t border-gray-50">
                        <td className="px-3 py-1.5 text-gray-700 font-medium">{m.name}</td>
                        <td className="px-3 py-1.5 text-right font-bold text-[#1B5E20]">{m.quantity}</td>
                        <td className="px-3 py-1.5 text-gray-400">{m.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {unmatched.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">
                ⚠ {unmatched.length} items not matched (will be skipped)
              </p>
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 max-h-28 overflow-y-auto">
                {unmatched.map(u => (
                  <div key={u.raw} className="text-xs text-amber-700 py-0.5">
                    {u.raw} <span className="text-amber-400 ml-1">(qty: {u.qty})</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !matched.length}
            className="flex items-center gap-2 bg-[#1B5E20] text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[#2E7D32] transition-colors disabled:opacity-40"
          >
            <Upload size={15} />
            {submitting ? 'Uploading…' : `Upload ${matched.length} items`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────── */
export default function LocationInventoryFormPage({
  params,
}: {
  params: { locationId: string };
}) {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { t } = useT();
  const locationName = searchParams.get('name') ?? 'Location';

  /* ── DB queries — items and sections for this store ── */
  const { data: dbItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['inventory-items', locationName],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('id, section, name, unit, sort_order, stores, store_sort_orders')
        .contains('stores', [locationName])
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as DbItem[];
    },
    enabled: !!locationName,
  });

  const { data: dbSections = [] } = useQuery({
    queryKey: ['inventory-sections', locationName],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_sections')
        .select('id, name, stores, sort_order')
        .contains('stores', [locationName])
        .order('sort_order', { ascending: true });
      if (error) {
        console.warn('inventory_sections not found, falling back to defaults');
        return [] as DbSection[];
      }
      return (data ?? []) as DbSection[];
    },
    enabled: !!locationName,
  });

  /* ── Derive ordered sections from DB (mirrors Inventory Lists logic) ── */
  const sections = useMemo<Section[]>(() => {
    const dbNames = dbSections.map(s => s.name);
    const base    = dbNames.length > 0 ? dbNames : SECTION_ORDER_FALLBACK;
    const extra   = [...new Set(dbItems.map(i => i.section))].filter(s => !base.includes(s));
    const titles  = [...base, ...extra];

    return titles
      .map(title => {
        const sectionItems = dbItems
          .filter(i => i.section === title)
          .slice()
          .sort((a, b) => {
            const aOrd = a.store_sort_orders?.[locationName] ?? a.sort_order;
            const bOrd = b.store_sort_orders?.[locationName] ?? b.sort_order;
            return aOrd - bOrd;
          })
          .map(i => ({ name: i.name, unit: i.unit }));
        return { title, data: sectionItems };
      })
      .filter(s => s.data.length > 0);
  }, [dbItems, dbSections, locationName]);

  const totalItems = sections.reduce((sum, s) => sum + s.data.length, 0);

  /* ── Local form state ── */
  const [counts, setCounts]         = useState<Record<string, string>>({});
  const [comment, setComment]       = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  const [savedOffline, setSavedOffline] = useState(false);
  const [submittedAt, setSubmittedAt]   = useState<string | null>(null);
  const [isStaff, setIsStaff]       = useState(false);
  const [isOnline, setIsOnline]     = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [syncing, setSyncing]       = useState(false);
  const [justSynced, setJustSynced] = useState(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Timer ── */
  const [timerStarted, setTimerStarted]   = useState(false);
  const [timerRunning, setTimerRunning]   = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer  = () => { setTimerStarted(true); setTimerRunning(true); };
  const pauseTimer  = () => setTimerRunning(false);
  const resumeTimer = () => setTimerRunning(true);

  useEffect(() => {
    if (timerRunning) {
      timerInterval.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    } else {
      if (timerInterval.current) clearInterval(timerInterval.current);
    }
    return () => { if (timerInterval.current) clearInterval(timerInterval.current); };
  }, [timerRunning]);

  /* ── Fetch role ── */
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('profiles').select('role').eq('id', user.id).single()
        .then(({ data }) => { if (data?.role?.startsWith('staff')) setIsStaff(true); });
    });
  }, []);

  /* ── Load draft on mount ── */
  useEffect(() => {
    const draft = loadDraft(params.locationId);
    if (draft) { setCounts(draft.counts); setComment(draft.comment); }
  }, [params.locationId]);

  /* ── Queue count ── */
  const refreshQueueCount = useCallback(async () => {
    const n = await pendingCount();
    setQueueCount(n);
  }, []);
  useEffect(() => { refreshQueueCount(); }, [refreshQueueCount]);

  /* ── Online / offline ── */
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = async () => {
      setIsOnline(true);
      const n = await pendingCount();
      if (n > 0) {
        setSyncing(true);
        await syncPendingQueue();
        await refreshQueueCount();
        setSyncing(false);
        setJustSynced(true);
        setTimeout(() => setJustSynced(false), 3000);
      }
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [refreshQueueCount]);

  /* ── Auto-save draft ── */
  useEffect(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => saveDraft(params.locationId, counts, comment), 800);
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current); };
  }, [counts, comment, params.locationId]);

  const filledCount = Object.values(counts).filter(v => v !== '' && v !== '0').length;
  const handleChange = (name: string, value: string) => setCounts(prev => ({ ...prev, [name]: value }));

  /* ── Submit ── */
  const handleSubmit = async () => {
    if (!window.confirm(`Submit inventory for ${locationName}? (${filledCount} / ${totalItems} items filled)`)) return;

    if (timerInterval.current) clearInterval(timerInterval.current);
    setTimerRunning(false);
    const durationSeconds = elapsedSeconds;
    setSubmitting(true);

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        alert('Could not get current user. Please log in again.');
        setSubmitting(false);
        return;
      }

      // Build submission data from live DB sections
      const data = sections.flatMap(section =>
        section.data.map(item => ({
          section:  section.title,
          name:     item.name,
          unit:     item.unit,
          quantity: parseInt(counts[item.name] ?? '0', 10) || 0,
        }))
      );

      if (!navigator.onLine) {
        await enqueue({
          locationId:      params.locationId,
          locationName,
          userId:          user.id,
          data,
          comment:         comment.trim() || null,
          durationSeconds: durationSeconds > 0 ? durationSeconds : null,
          queuedAt:        new Date().toISOString(),
        });
        clearDraft(params.locationId);
        await refreshQueueCount();
        setSavedOffline(true);
        setCounts({});
        setComment('');
      } else {
        const now = new Date().toISOString();
        const { error: insertError } = await supabase
          .from('inventory_submissions')
          .insert({
            location_id:      params.locationId,
            location_name:    locationName,
            submitted_by:     user.id,
            submitted_at:     now,
            data,
            comment:          comment.trim() || null,
            duration_seconds: durationSeconds > 0 ? durationSeconds : null,
          });

        if (insertError) { alert(`Error: ${insertError.message}`); setSubmitting(false); return; }

        setSubmittedAt(now);
        clearDraft(params.locationId);
        const n = await pendingCount();
        if (n > 0) {
          setSyncing(true);
          await syncPendingQueue();
          await refreshQueueCount();
          setSyncing(false);
        }
        setSubmitted(true);
        setCounts({});
        setComment('');
      }
    } catch (e: unknown) {
      alert((e as Error)?.message ?? 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    if (!window.confirm('Do you really want to reset? All entered quantities will be set back to 0.')) return;
    setCounts({});
    setComment('');
    clearDraft(params.locationId);
  };

  const startNew = () => {
    setCounts({});
    setComment('');
    setSubmitted(false);
    setSavedOffline(false);
    setSubmittedAt(null);
    setTimerStarted(false);
    setTimerRunning(false);
    setElapsedSeconds(0);
    if (timerInterval.current) clearInterval(timerInterval.current);
  };

  /* ─── Offline-saved screen ─── */
  if (savedOffline) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center px-4">
        <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
          <WifiOff size={30} className="text-amber-500" />
        </div>
        <h2 className="text-xl font-bold text-gray-900">Saved Offline</h2>
        <p className="text-sm text-gray-500 max-w-sm">
          Your inventory count has been saved to this device. It will sync automatically to the server as soon as you have an internet connection.
        </p>
        {queueCount > 0 && (
          <div className={`flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-full ${
            syncing ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'
          }`}>
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing now…' : `${queueCount} submission${queueCount > 1 ? 's' : ''} waiting to sync`}
          </div>
        )}
        {justSynced && queueCount === 0 && (
          <div className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-full bg-green-50 text-green-700">
            <CheckCircle2 size={14} />All synced successfully
          </div>
        )}
        <div className="flex gap-3 mt-2">
          <button onClick={startNew} className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
            New Submission
          </button>
          {!isStaff && (
            <button onClick={() => router.push('/inventory/counts')} className="px-4 py-2 bg-[#1B5E20] text-white rounded-lg text-sm font-medium hover:bg-[#2E7D32]">
              View Reports
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ─── Online-submitted screen ─── */
  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#1B5E20" strokeWidth="2.5">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900">Inventory Submitted</h2>
        <p className="text-sm text-gray-500">Your inventory for {locationName} has been saved.</p>
        <div className="flex flex-wrap gap-3 mt-2 justify-center">
          <button onClick={startNew} className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
            New Submission
          </button>
          {submittedAt && isEditable(submittedAt) && (
            <button onClick={() => router.push('/inventory/counts')}
              className="flex items-center gap-2 px-4 py-2 border border-amber-300 bg-amber-50 text-amber-700 rounded-lg text-sm font-medium hover:bg-amber-100 transition-colors">
              <Pencil size={14} />Edit this submission
            </button>
          )}
          {!isStaff && (
            <button onClick={() => router.push('/inventory/counts')} className="px-4 py-2 bg-[#1B5E20] text-white rounded-lg text-sm font-medium hover:bg-[#2E7D32]">
              View Current Inventory
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ─── Main form ─── */
  return (
    <div className="flex flex-col h-full">

      {showUpload && (
        <UploadInventoryModal
          locationId={params.locationId}
          locationName={locationName}
          onClose={() => setShowUpload(false)}
          onUploaded={() => setShowUpload(false)}
          sections={sections}
        />
      )}

      {/* Header */}
      <div className="mb-5">
        <button onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors mb-3">
          <ChevronLeft size={16} />Back
        </button>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{locationName} — Inventory</h1>
            {itemsLoading && (
              <p className="text-xs text-gray-400 mt-1 animate-pulse">Loading items…</p>
            )}
            {!itemsLoading && (
              <p className="text-xs text-gray-400 mt-1">{totalItems} items · {sections.length} sections</p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {timerStarted && (
              <button onClick={handleReset}
                className="flex items-center gap-1.5 border border-red-200 text-red-500 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-red-50 transition-colors">
                <RotateCcw size={14} />Reset
              </button>
            )}

            <button onClick={() => setShowUpload(true)}
              className="flex items-center gap-1.5 border border-[#1B5E20] text-[#1B5E20] px-3 py-2 rounded-lg text-sm font-semibold hover:bg-[#1B5E20]/5 transition-colors">
              <Upload size={14} />Upload
            </button>

            {!timerStarted ? (
              <button onClick={startTimer} disabled={itemsLoading}
                className="flex items-center gap-2 bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#2E7D32] transition-colors disabled:opacity-50">
                <Play size={14} />Start Inventory
              </button>
            ) : (
              <div className="flex-shrink-0 flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
                <Timer size={15} className={timerRunning ? 'text-[#1B5E20]' : 'text-gray-400'} />
                <span className="text-base font-mono font-bold text-gray-800 tabular-nums min-w-[52px]">
                  {formatTimer(elapsedSeconds)}
                </span>
                {timerRunning ? (
                  <button onClick={pauseTimer} className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 font-medium ml-1">
                    <Pause size={13} />Pause
                  </button>
                ) : (
                  <button onClick={resumeTimer} className="flex items-center gap-1 text-xs text-[#1B5E20] hover:text-[#2E7D32] font-medium ml-1">
                    <Play size={13} />Resume
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Status banners */}
      {!isOnline && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-3 text-sm text-amber-700">
          <WifiOff size={15} className="text-amber-500 flex-shrink-0" />
          <span><strong>You're offline.</strong> Keep counting — your data will be saved locally and synced when you reconnect.</span>
        </div>
      )}
      {isOnline && syncing && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 mb-3 text-sm text-blue-700">
          <RefreshCw size={15} className="animate-spin text-blue-500 flex-shrink-0" />
          Syncing offline submissions…
        </div>
      )}
      {isOnline && justSynced && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 mb-3 text-sm text-green-700">
          <CheckCircle2 size={15} className="text-green-500 flex-shrink-0" />
          Offline submissions synced successfully.
        </div>
      )}
      {isOnline && !syncing && !justSynced && queueCount > 0 && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-3 text-sm text-amber-700">
          <RefreshCw size={15} className="text-amber-500 flex-shrink-0" />
          {queueCount} offline submission{queueCount > 1 ? 's' : ''} pending sync.
        </div>
      )}

      {/* Loading skeleton */}
      {itemsLoading && (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-100 overflow-hidden">
              <div className="h-9 bg-gray-200 animate-pulse" />
              {[...Array(4)].map((_, j) => (
                <div key={j} className="flex items-center gap-4 px-4 py-3 border-b border-gray-50">
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 bg-gray-100 rounded w-40 animate-pulse" />
                    <div className="h-2.5 bg-gray-100 rounded w-24 animate-pulse" />
                  </div>
                  <div className="h-8 w-20 bg-gray-100 rounded-lg animate-pulse" />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Sections */}
      {!itemsLoading && (
        <div className="flex-1 space-y-4">
          {sections.map(section => (
            <div key={section.title} className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5" style={{ backgroundColor: '#1B5E20' }}>
                <span className="text-white text-xs font-bold tracking-widest uppercase">{section.title}</span>
                <span className="text-green-300 text-xs font-medium">{section.data.length} items</span>
              </div>
              <div>
                {section.data.map((item, idx) => (
                  <div
                    key={item.name}
                    className={`flex items-center gap-4 px-4 py-3 ${idx < section.data.length - 1 ? 'border-b border-gray-100' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{item.name}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{item.unit}</div>
                    </div>
                    <select
                      value={counts[item.name] ?? '0'}
                      onChange={e => handleChange(item.name, e.target.value)}
                      disabled={!timerStarted}
                      className={`w-20 text-right border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] transition-colors ${
                        timerStarted
                          ? counts[item.name] && counts[item.name] !== '0'
                            ? 'border-[#1B5E20] bg-green-50 text-[#1B5E20] font-semibold'
                            : 'border-gray-200 bg-gray-50'
                          : 'border-gray-100 bg-gray-100 text-gray-300 cursor-not-allowed'
                      }`}
                    >
                      {Array.from({ length: 51 }, (_, i) => (
                        <option key={i} value={String(i)}>{i}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Comment box */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden mb-28">
            <div className="flex items-center justify-between px-4 py-2.5" style={{ backgroundColor: '#1B5E20' }}>
              <span className="text-white text-xs font-bold tracking-widest uppercase">Comments</span>
            </div>
            <div className="px-4 py-3">
              <textarea
                rows={3}
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Add any extra comments or notes for this inventory report…"
                disabled={!timerStarted}
                className={`w-full border rounded-lg px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B5E20] resize-none transition-colors ${
                  timerStarted
                    ? 'border-gray-200 bg-gray-50 text-gray-800'
                    : 'border-gray-100 bg-gray-100 text-gray-300 cursor-not-allowed'
                }`}
              />
            </div>
          </div>
        </div>
      )}

      {/* Fixed bottom bar */}
      <div className="fixed bottom-0 left-0 md:left-60 right-0 bg-white border-t border-gray-200 px-4 md:px-6 py-3 flex items-center justify-between shadow-lg z-10">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 font-medium">
            {filledCount} / {totalItems} items filled
          </span>
          {isOnline
            ? <span className="flex items-center gap-1 text-xs text-green-600"><Wifi size={12} /> Online</span>
            : <span className="flex items-center gap-1 text-xs text-amber-600"><WifiOff size={12} /> Offline</span>
          }
        </div>
        <button
          onClick={handleSubmit}
          disabled={submitting || !timerStarted || itemsLoading}
          className="flex items-center gap-2 bg-[#1B5E20] text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-[#2E7D32] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send size={15} />
          {submitting ? 'Saving…' : isOnline ? 'Submit' : 'Save Offline'}
        </button>
      </div>
    </div>
  );
}
