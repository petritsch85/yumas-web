'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { saveDraft, loadDraft, clearDraft } from '@/lib/draft-store';
import { enqueue, dequeueAll, removeFromQueue, pendingCount } from '@/lib/offline-queue';
import { ChevronLeft, Send, WifiOff, Wifi, RefreshCw, CheckCircle2, Timer, Play, Pause, X, AlertCircle, RotateCcw, Pencil } from 'lucide-react';
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

/* ─── Main Page ──────────────────────────────────────────────────────────── */
export default function LocationInventoryFormPage({
  params: _params,
}: {
  params: { locationId: string };
}) {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { t } = useT();
  const locationName = searchParams.get('name') ?? 'Location';

  // useParams() reliably reads the URL segment on the client regardless of
  // whether Next.js has made the params prop async (Next.js 15 behaviour).
  const { locationId } = useParams() as { locationId: string };

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
  const [submitted, setSubmitted]   = useState(false);
  const [savedOffline, setSavedOffline] = useState(false);
  const [submittedAt, setSubmittedAt]   = useState<string | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [isEditingSubmission, setIsEditingSubmission] = useState(false);
  const [originalSubData, setOriginalSubData]         = useState<{ section: string; name: string; unit: string; quantity: number }[] | null>(null);
  const [subAlreadyEdited, setSubAlreadyEdited]       = useState(false);
  const [lastSubmittedCounts, setLastSubmittedCounts] = useState<Record<string, string>>({});
  const [lastSubmittedComment, setLastSubmittedComment] = useState('');
  const [isStaff, setIsStaff]       = useState(false);
  const [isOnline, setIsOnline]     = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [syncing, setSyncing]       = useState(false);
  const [justSynced, setJustSynced] = useState(false);
  const [loadingPrevious, setLoadingPrevious] = useState(false);
  const [draftRestored, setDraftRestored] = useState<string | null>(null); // savedAt timestamp when a draft was restored
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

  /* ── Disable horizontal scroll for the lifetime of this page ── */
  useEffect(() => {
    const prev = document.body.style.overflowX;
    document.body.style.overflowX = 'hidden';
    return () => { document.body.style.overflowX = prev; };
  }, []);

  /* ── Fetch role ── */
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('profiles').select('role').eq('id', user.id).single()
        .then(({ data }) => { if (data?.role?.startsWith('staff')) setIsStaff(true); });
    });
  }, []);

  /* ── Check for existing editable submission from this user ── */
  const { data: existingSubmission } = useQuery<{
    id: string; submitted_at: string; edited_at: string | null;
    data: { section: string; name: string; unit: string; quantity: number }[];
    comment: string | null;
  } | null>({
    queryKey: ['latest-my-submission', locationId],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from('inventory_submissions')
        .select('id, submitted_at, edited_at, data, comment')
        .eq('location_id', locationId)
        .eq('submitted_by', user.id)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data || !isEditable(data.submitted_at)) return null;
      return data as { id: string; submitted_at: string; edited_at: string | null; data: { section: string; name: string; unit: string; quantity: number }[]; comment: string | null };
    },
    staleTime: 0,
  });

  const loadExistingSubmission = () => {
    if (!existingSubmission) return;
    const restored = Object.fromEntries(
      existingSubmission.data.map(d => [d.name, String(d.quantity)])
    );
    setCounts(restored);
    setComment(existingSubmission.comment ?? '');
    setSubmissionId(existingSubmission.id);
    setSubmittedAt(existingSubmission.submitted_at);
    setOriginalSubData(existingSubmission.data);
    setSubAlreadyEdited(!!existingSubmission.edited_at);
    setIsEditingSubmission(true);
    setSubmitted(false);
  };

  /* ── Load draft on mount ── */
  useEffect(() => {
    const draft = loadDraft(locationId);
    if (!draft) return;
    // Only restore if there's something meaningful saved
    const hasData = Object.values(draft.counts).some(v => v !== '' && v !== '0');
    if (!hasData && !draft.comment) return;
    setCounts(draft.counts);
    setComment(draft.comment);
    if (draft.timerStarted) {
      setElapsedSeconds(draft.elapsedSeconds ?? 0);
      setTimerStarted(true);
      setTimerRunning(true); // auto-resume so they can keep entering immediately
    }
    setDraftRestored(draft.savedAt);
  }, [locationId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /* ── Auto-save draft (every ~800 ms after last change) ── */
  useEffect(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(
      () => saveDraft(locationId, counts, comment, elapsedSeconds, timerStarted),
      800,
    );
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current); };
  }, [counts, comment, locationId, elapsedSeconds, timerStarted]);

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
          locationId:      locationId,
          locationName,
          userId:          user.id,
          data,
          comment:         comment.trim() || null,
          durationSeconds: durationSeconds > 0 ? durationSeconds : null,
          queuedAt:        new Date().toISOString(),
        });
        clearDraft(locationId);
        await refreshQueueCount();
        setSavedOffline(true);
        setCounts({});
        setComment('');
      } else {
        const now = new Date().toISOString();

        if (isEditingSubmission && submissionId) {
          // UPDATE existing submission within edit window
          const updatePayload: Record<string, unknown> = {
            data,
            comment:      comment.trim() || null,
            submitted_at: now,
            edited_at:    now,
            edited_by:    user.id,
          };
          // Preserve the true original across multiple edits (only store once)
          if (!subAlreadyEdited && originalSubData) {
            updatePayload.original_data = originalSubData;
          }
          const { error: updateError } = await supabase
            .from('inventory_submissions')
            .update(updatePayload)
            .eq('id', submissionId)
            .eq('submitted_by', user.id);
          if (updateError) { alert(`Error updating: ${updateError.message}`); setSubmitting(false); return; }
          setLastSubmittedCounts(counts);
          setLastSubmittedComment(comment);
          setSubmittedAt(now);
          clearDraft(locationId);
          localStorage.setItem(`yumas_recent_inv_${locationId}`, now);
          setSubmitted(true);
          setCounts({});
          setComment('');
        } else {
          // INSERT new submission
          const { data: inserted, error: insertError } = await supabase
            .from('inventory_submissions')
            .insert({
              location_id:      locationId,
              location_name:    locationName,
              submitted_by:     user.id,
              submitted_at:     now,
              data,
              comment:          comment.trim() || null,
              duration_seconds: durationSeconds > 0 ? durationSeconds : null,
            })
            .select('id')
            .single();

          if (insertError) { alert(`Error: ${insertError.message}`); setSubmitting(false); return; }

          setSubmissionId(inserted?.id ?? null);
          setLastSubmittedCounts(counts);
          setLastSubmittedComment(comment);
          setSubmittedAt(now);
          clearDraft(locationId);
          localStorage.setItem(`yumas_recent_inv_${locationId}`, now);
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
    clearDraft(locationId);
  };

  const startNew = () => {
    setCounts({});
    setComment('');
    setSubmitted(false);
    setSavedOffline(false);
    setSubmittedAt(null);
    setSubmissionId(null);
    setIsEditingSubmission(false);
    setLastSubmittedCounts({});
    setLastSubmittedComment('');
    setTimerStarted(false);
    setTimerRunning(false);
    setElapsedSeconds(0);
    setDraftRestored(null);
    if (timerInterval.current) clearInterval(timerInterval.current);
    // Clear the recent-submission marker so the picker doesn't show a stale banner
    localStorage.removeItem(`yumas_recent_inv_${locationId}`);
  };

  const editSubmitted = () => {
    setCounts(lastSubmittedCounts);
    setComment(lastSubmittedComment);
    setIsEditingSubmission(true);
    setSubmitted(false);
  };

  /* ── Load most recent submission for this location and pre-fill the form ── */
  const handleLoadPrevious = async () => {
    setLoadingPrevious(true);
    try {
      // Fetch the most recent submission for this location (by anyone).
      // We intentionally do NOT filter by submitted_by — the reports page can
      // already see all submissions for a location, so RLS allows it, and a
      // manager loading the last count regardless of who submitted it is useful.
      const { data: row, error } = await supabase
        .from('inventory_submissions')
        .select('id, submitted_at, submitted_by, data, comment, edited_at')
        .eq('location_id', locationId)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        alert(`Error loading submission: ${error.message}`);
        return;
      }

      if (!row) {
        alert('No previous submission found for this location.');
        return;
      }

      const submissionData = row.data as { name: string; quantity: number }[];
      const restored = Object.fromEntries(
        submissionData.map((d) => [d.name, String(d.quantity)])
      );
      setCounts(restored);
      setComment(row.comment ?? '');

      // Capture original data for diff tracking (used when saving the edit)
      setOriginalSubData(row.data as { section: string; name: string; unit: string; quantity: number }[]);
      setSubAlreadyEdited(!!(row as any).edited_at);

      // Only enter edit mode if it was submitted by the current user and is still editable
      if (isEditable(row.submitted_at)) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user && row.submitted_by === user.id) {
          setSubmissionId(row.id);
          setSubmittedAt(row.submitted_at);
          setIsEditingSubmission(true);
        }
      }

      // Auto-start the timer so the user can begin editing immediately
      setTimerStarted(true);
      setTimerRunning(true);
    } catch (e: unknown) {
      alert((e as Error)?.message ?? 'Could not load previous submission.');
    } finally {
      setLoadingPrevious(false);
    }
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
    const deadline = submittedAt ? (() => {
      const d = new Date(submittedAt);
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    })() : null;
    const timeStr = submittedAt
      ? new Date(submittedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
      : '';
    const deadlineStr = deadline
      ? deadline.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
      : '';
    const editable = submittedAt ? isEditable(submittedAt) : false;

    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 px-4">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#1B5E20" strokeWidth="2.5">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900">
          {isEditingSubmission ? 'Submission Updated' : 'Inventory Submitted'}
        </h2>
        <p className="text-sm text-gray-500 text-center">
          {locationName} · {timeStr}
        </p>

        {editable && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 max-w-xs text-center">
            <Pencil size={13} className="flex-shrink-0" />
            <span>You can make changes until <strong>{deadlineStr} tomorrow</strong></span>
          </div>
        )}

        <div className="flex flex-wrap gap-3 mt-1 justify-center">
          {editable && (
            <button onClick={editSubmitted}
              className="flex items-center gap-2 px-4 py-2 border border-amber-300 bg-amber-50 text-amber-700 rounded-lg text-sm font-medium hover:bg-amber-100 transition-colors">
              <Pencil size={14} /> Edit submission
            </button>
          )}
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

  /* ─── Main form ─── */
  return (
    <div className="flex flex-col h-full">

      {/* Editing-mode banner */}
      {isEditingSubmission && submittedAt && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
          <Pencil size={14} className="flex-shrink-0" />
          <span>
            Editing submission from{' '}
            <strong>{new Date(submittedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</strong>
            {' '}— changes will overwrite your previous counts.
          </span>
        </div>
      )}

      {/* Existing-submission banner (shown on fresh load if a recent submission exists) */}
      {!isEditingSubmission && !submitted && existingSubmission && (
        <div className="mb-4 flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
          <div className="flex items-center gap-2">
            <Pencil size={14} className="flex-shrink-0" />
            <span>
              You submitted at{' '}
              <strong>{new Date(existingSubmission.submitted_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</strong>.
              {' '}Edit it until 09:00 tomorrow.
            </span>
          </div>
          <button
            onClick={loadExistingSubmission}
            className="flex-shrink-0 px-3 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg text-xs font-semibold transition-colors">
            Edit
          </button>
        </div>
      )}

      {/* Header */}
      <div className="mb-5">
        <button onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors mb-3">
          <ChevronLeft size={16} />Back
        </button>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 truncate">{locationName}</h1>
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

            {!timerStarted ? (
              <div className="flex flex-col items-end gap-2">
                <button onClick={startTimer} disabled={itemsLoading}
                  className="flex items-center gap-2 bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#2E7D32] transition-colors disabled:opacity-50">
                  <Play size={14} />Start Inventory
                </button>
                <button
                  onClick={handleLoadPrevious}
                  disabled={itemsLoading || loadingPrevious}
                  className="flex items-center gap-2 bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-orange-600 transition-colors disabled:opacity-50">
                  <Pencil size={14} />{loadingPrevious ? 'Loading…' : 'Edit Inventory'}
                </button>
              </div>
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

      {/* Draft-restored banner */}
      {draftRestored && (
        <div className="flex items-center justify-between gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 mb-3 text-sm text-blue-700">
          <div className="flex items-center gap-2 min-w-0">
            <RotateCcw size={15} className="text-blue-500 flex-shrink-0" />
            <span className="truncate">
              <strong>Draft restored</strong> · saved at{' '}
              {new Date(draftRestored).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
              {' '}— your previous entries have been reloaded.
            </span>
          </div>
          <button
            onClick={() => setDraftRestored(null)}
            className="flex-shrink-0 text-blue-400 hover:text-blue-600 transition-colors"
            aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}

      {/* Paused banner */}
      {timerStarted && !timerRunning && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-3 text-sm text-amber-700">
          <Pause size={15} className="text-amber-500 flex-shrink-0" />
          <span><strong>Timer paused.</strong> Resume the timer to continue entering counts.</span>
          <button
            onClick={resumeTimer}
            className="ml-auto flex items-center gap-1.5 text-xs font-semibold bg-amber-100 hover:bg-amber-200 px-2.5 py-1 rounded-lg transition-colors flex-shrink-0">
            <Play size={11} />Resume
          </button>
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
                      disabled={!timerStarted || !timerRunning}
                      className={`w-20 text-right border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] transition-colors ${
                        !timerStarted
                          ? 'border-gray-100 bg-gray-100 text-gray-300 cursor-not-allowed'
                          : !timerRunning
                          ? 'border-amber-200 bg-amber-50 text-amber-400 cursor-not-allowed'
                          : counts[item.name] && counts[item.name] !== '0'
                          ? 'border-[#1B5E20] bg-green-50 text-[#1B5E20] font-semibold'
                          : 'border-gray-200 bg-gray-50'
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
                disabled={!timerStarted || !timerRunning}
                className={`w-full border rounded-lg px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B5E20] resize-none transition-colors ${
                  !timerStarted
                    ? 'border-gray-100 bg-gray-100 text-gray-300 cursor-not-allowed'
                    : !timerRunning
                    ? 'border-amber-200 bg-amber-50 text-amber-400 cursor-not-allowed'
                    : 'border-gray-200 bg-gray-50 text-gray-800'
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
          disabled={submitting || !timerStarted || !timerRunning || itemsLoading}
          className="flex items-center gap-2 bg-[#1B5E20] text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-[#2E7D32] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send size={15} />
          {submitting ? 'Saving…' : isEditingSubmission ? 'Update' : isOnline ? 'Submit' : 'Save Offline'}
        </button>
      </div>
    </div>
  );
}
