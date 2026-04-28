'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase-browser';
import { saveDraft, loadDraft, clearDraft } from '@/lib/draft-store';
import { enqueue, dequeueAll, removeFromQueue, pendingCount } from '@/lib/offline-queue';
import { ChevronLeft, Send, WifiOff, Wifi, RefreshCw, CheckCircle2, Timer, Play, Pause } from 'lucide-react';

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

type Item    = { name: string; unit: string };
type Section = { title: string; data: Item[] };

const SECTIONS: Section[] = [
  {
    title: 'Kühlhaus',
    data: [
      { name: 'Guacamole', unit: '1/6 GN groß' },
      { name: 'Schärfemix', unit: 'Beutel (0.5kg)' },
      { name: 'Maissalsa', unit: '1/6 GN groß' },
      { name: 'Tomatensalsa', unit: '1/6 GN groß' },
      { name: 'Sour Cream', unit: '1/6 GN groß' },
      { name: 'Marinade Chicken', unit: 'Beutel (1.0kg)' },
      { name: 'Pico de Gallo', unit: '1/2 GN' },
      { name: 'Crema Nogada', unit: 'Beutel (1.0kg)' },
      { name: 'Käse Gouda', unit: 'Beutel (5.0kg)' },
      { name: 'Gouda Scheiben Gringa', unit: 'Packung' },
      { name: 'Ciabatta', unit: 'Stück' },
      { name: 'Brownie', unit: 'Blech' },
      { name: 'Carlota de Limon', unit: 'Stück' },
      { name: 'Schoko- Avocado Mousse', unit: 'Blech' },
      { name: 'Mole', unit: '1/6 GN groß' },
      { name: 'Marinade Al Pastor', unit: 'Beutel (1.5kg)' },
      { name: 'Barbacoa', unit: '1/6 GN groß' },
      { name: 'Chili con Carne', unit: '1/6 GN groß' },
      { name: 'Cochinita', unit: '1/6 GN groß' },
      { name: 'Kartoffel Würfel', unit: 'Beutel (3.0kg)' },
      { name: 'Vinaigrette', unit: 'Behälter (1.0l)' },
      { name: 'Honig Sesam / Senf', unit: 'Behälter (1.0l)' },
      { name: 'Pozole', unit: 'Beutel (1.0kg)' },
      { name: 'Zwiebeln karamellisiert', unit: 'Beutel (1.0kg)' },
      { name: 'Karotten karamellisiert', unit: 'Beutel (10 Stück)' },
      { name: 'Bohnencreme', unit: 'Beutel (2.5kg)' },
      { name: 'Alambre - Zwiebel', unit: 'Beutel (2.0kg)' },
      { name: 'Weizen Tortillas 12cm', unit: 'Kisten' },
      { name: 'Tortillas 30cm', unit: 'Kisten' },
      { name: 'Frische Habaneros', unit: 'Stück' },
      { name: 'Salsa Habanero', unit: 'Beutel (1.5kg)' },
      { name: 'Salsa Verde', unit: 'Beutel (2.0kg)' },
      { name: 'Chipotle SourCream', unit: 'Beutel (2.0kg)' },
      { name: 'Salsa de Jamaica', unit: 'Beutel (0.5kg)' },
      { name: 'Salsa Torta', unit: 'Beutel (1.0kg)' },
      { name: 'Humo Salsa', unit: 'Flasche' },
      { name: 'Fuego Salsa', unit: 'Flasche' },
      { name: 'Oliven entkernt', unit: 'Glas' },
      { name: 'Chiles Poblanos', unit: 'Stück' },
      { name: 'Salsa Pitaya', unit: 'Beutel (0.5kg)' },
      { name: 'Mais Tortillas 12cm', unit: 'Beutel (50 Stk)' },
      { name: 'Blau Mais Tortillas 15cm', unit: 'Beutel (40 Stk)' },
      { name: 'Queso Cotija', unit: 'Pack (1.0kg)' },
      { name: 'Queso Oaxaca', unit: 'Pack (1.0kg)' },
      { name: 'Queso Chihuahua', unit: 'Pack (1.0kg)' },
      { name: 'Rinderfilet Steak', unit: 'Beutel (250g)' },
      { name: 'Filetspitzen', unit: 'Beutel (100g)' },
      { name: 'Hähnchenkeule (ganz)', unit: 'Beutel (2 Stück)' },
      { name: 'Mole Rojo', unit: 'Beutel (2.0kg)' },
      { name: 'Chorizo', unit: 'Beutel (1.0kg)' },
      { name: 'Carne Vegetal', unit: 'Beutel (1.0kg)' },
      { name: 'Costilla de Res', unit: 'Beutel (4 Portionen)' },
      { name: 'Salsa für Costilla de Res', unit: 'Beutel (2L)' },
      { name: 'Rote Zwiebeln eingelegt', unit: '1/6 GN groß' },
      { name: 'Pulpo (Chipulpotle)', unit: 'Beutel (100 g)' },
      { name: 'Salsa Pulpo', unit: 'Beutel (0.5kg)' },
      { name: 'Birria', unit: 'Beutel (2.0kg)' },
      { name: 'Salsa Birria', unit: 'Beutel (1.0kg)' },
      { name: 'Füllung Nogada', unit: 'Beutel (1.0kg)' },
      { name: 'H-Milch 3,5%', unit: 'Packung' },
    ],
  },
  {
    title: 'Tiefkühler',
    data: [
      { name: 'Alambre - Paprika Streifen', unit: 'Beutel (2.5kg)' },
      { name: 'Gambas', unit: 'Beutel (1.0kg)' },
      { name: 'Weizentortillas 20cm', unit: 'Karton' },
    ],
  },
  {
    title: 'Trockenware',
    data: [
      { name: 'Reis', unit: 'Beutel (1kg)' },
      { name: 'Schwarze Bohnen', unit: 'Sack (5kg)' },
      { name: 'Salz', unit: 'Eimer (10kg)' },
      { name: 'Zucker', unit: 'Packung (1.0kg)' },
      { name: 'Brauner Zucker', unit: 'Packung' },
      { name: 'Pfeffer', unit: 'Packung' },
      { name: 'Pfeffer geschrotet', unit: 'Packung' },
      { name: 'Rapsöl', unit: 'Kanister (10L)' },
      { name: 'Tajin', unit: 'Packung' },
      { name: 'Limettensaft (750ml Metro)', unit: 'Flasche' },
    ],
  },
  {
    title: 'Regale',
    data: [
      { name: 'Große Bowl togo Schale', unit: 'Packungen (40 Stk)' },
      { name: 'Große Bowl togo Deckel', unit: 'Packungen (40 Stk)' },
      { name: 'Kleine Bowl togo Schale', unit: 'Packungen (40 Stk)' },
      { name: 'Kleine Bowl togo Deckel', unit: 'Packungen (40 Stk)' },
      { name: 'Dressingsbecher Schale', unit: '50er Pack' },
      { name: 'Dressingsbecher Deckel', unit: '50er Pack' },
      { name: 'Alufolie', unit: 'Rolle' },
      { name: 'Backpapier', unit: 'Rolle' },
      { name: 'Trayliner Papier', unit: 'Karton' },
      { name: 'Weiße Serviette', unit: 'Karton' },
      { name: 'Zig-Zag Papier', unit: 'Karton' },
      { name: 'Müllbeutel Blau 120L', unit: '120L Rolle' },
      { name: 'Handschuhe M', unit: 'Packung' },
      { name: 'Handschuhe L', unit: 'Packung' },
      { name: 'Mehrwegbowl', unit: 'Stück' },
    ],
  },
  {
    title: 'Lager',
    data: [
      { name: 'Große Togo Tüte', unit: 'Kartons (250 Stk)' },
      { name: 'Kleine Togo Tüte', unit: 'Kartons (250 Stk)' },
      { name: 'Schwarze Serviette', unit: 'Karton' },
      { name: 'Nachos', unit: 'Karton (12 Beutel)' },
      { name: 'Spüli', unit: 'Flasche' },
      { name: 'Essigessenz', unit: 'Flasche' },
      { name: 'Topfschwamm', unit: 'Packung (10Stk)' },
      { name: 'Edelstahlschwamm', unit: 'Packung (10Stk)' },
      { name: 'Reinigungshandschuhe', unit: 'Packung (2Stk)' },
      { name: 'Blaue Rolle', unit: 'Rolle' },
      { name: 'Toilettenpapier', unit: 'Packung' },
      { name: 'Glasreiniger', unit: 'Kanister' },
      { name: 'WC Reiniger', unit: 'Kanister' },
      { name: 'Desinfektionsreiniger', unit: 'Kanister' },
      { name: 'Gastro Universal Reiniger', unit: 'Kanister' },
      { name: 'Kalkreiniger', unit: 'Kanister' },
      { name: 'Laminat - Parkett-Reiniger', unit: 'Kanister' },
      { name: 'B100N', unit: 'Kanister' },
      { name: 'B200S', unit: 'Kanister' },
      { name: 'F8500', unit: 'Kanister' },
      { name: 'F420E', unit: 'Kanister' },
      { name: 'Spülmaschine Salz - Etolit', unit: 'Beutel' },
    ],
  },
];

const TOTAL_ITEMS = SECTIONS.reduce((sum, s) => sum + s.data.length, 0);

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
        duration_seconds: (item as any).durationSeconds ?? null,
      });
      if (!error) {
        await removeFromQueue(item.id!);
        synced++;
      }
    } catch { /* network still unavailable for this item */ }
  }
  return synced;
}

export default function LocationInventoryFormPage({
  params,
}: {
  params: { locationId: string };
}) {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const locationName = searchParams.get('name') ?? 'Location';

  const [counts, setCounts]         = useState<Record<string, string>>({});
  const [comment, setComment]       = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  const [savedOffline, setSavedOffline] = useState(false);
  const [isOnline, setIsOnline]     = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [syncing, setSyncing]       = useState(false);
  const [justSynced, setJustSynced] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Timer ──
  const [timerStarted, setTimerStarted]   = useState(false);
  const [timerRunning, setTimerRunning]   = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = () => {
    setTimerStarted(true);
    setTimerRunning(true);
  };
  const pauseTimer = () => setTimerRunning(false);
  const resumeTimer = () => setTimerRunning(true);

  useEffect(() => {
    if (timerRunning) {
      timerInterval.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    } else {
      if (timerInterval.current) clearInterval(timerInterval.current);
    }
    return () => { if (timerInterval.current) clearInterval(timerInterval.current); };
  }, [timerRunning]);

  /* ── Load draft on mount ── */
  useEffect(() => {
    const draft = loadDraft(params.locationId);
    if (draft) {
      setCounts(draft.counts);
      setComment(draft.comment);
      setDraftLoaded(true);
    }
  }, [params.locationId]);

  /* ── Refresh queue count from IndexedDB ── */
  const refreshQueueCount = useCallback(async () => {
    const n = await pendingCount();
    setQueueCount(n);
  }, []);

  useEffect(() => { refreshQueueCount(); }, [refreshQueueCount]);

  /* ── Online / offline detection ── */
  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = async () => {
      setIsOnline(true);
      // Auto-sync any queued submissions
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

  /* ── Auto-save draft (debounced 800 ms) ── */
  useEffect(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      saveDraft(params.locationId, counts, comment);
    }, 800);
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current); };
  }, [counts, comment, params.locationId]);

  const filledCount = Object.values(counts).filter((v) => v.trim() !== '').length;

  const handleChange = (name: string, value: string) => {
    setCounts((prev) => ({ ...prev, [name]: value }));
  };

  /* ── Submit ── */
  const handleSubmit = async () => {
    if (!window.confirm(`Submit inventory for ${locationName}? (${filledCount} / ${TOTAL_ITEMS} items filled)`)) return;

    // Stop the timer and capture final elapsed time
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

      const data = SECTIONS.flatMap((section) =>
        section.data.map((item) => ({
          section:  section.title,
          name:     item.name,
          unit:     item.unit,
          quantity: parseFloat(counts[item.name] ?? '0') || 0,
        }))
      );

      if (!navigator.onLine) {
        // ── Offline path: save to IndexedDB queue ──
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
        // ── Online path: submit directly ──
        const { error: insertError } = await supabase
          .from('inventory_submissions')
          .insert({
            location_id:      params.locationId,
            location_name:    locationName,
            submitted_by:     user.id,
            submitted_at:     new Date().toISOString(),
            data,
            comment:          comment.trim() || null,
            duration_seconds: durationSeconds > 0 ? durationSeconds : null,
          });

        if (insertError) {
          alert(`Error: ${insertError.message}`);
          setSubmitting(false);
          return;
        }

        clearDraft(params.locationId);
        // Also drain any queued items opportunistically
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

  const startNew = () => {
    setCounts({});
    setComment('');
    setSubmitted(false);
    setSavedOffline(false);
    setDraftLoaded(false);
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
            <CheckCircle2 size={14} />
            All synced successfully
          </div>
        )}
        <div className="flex gap-3 mt-2">
          <button
            onClick={startNew}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            New Submission
          </button>
          <button
            onClick={() => router.push('/inventory/counts')}
            className="px-4 py-2 bg-[#1B5E20] text-white rounded-lg text-sm font-medium hover:bg-[#2E7D32]"
          >
            View Reports
          </button>
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
        <div className="flex gap-3 mt-2">
          <button
            onClick={startNew}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            New Submission
          </button>
          <button
            onClick={() => router.push('/inventory/counts')}
            className="px-4 py-2 bg-[#1B5E20] text-white rounded-lg text-sm font-medium hover:bg-[#2E7D32]"
          >
            View Current Inventory
          </button>
        </div>
      </div>
    );
  }

  /* ─── Main form ─── */
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ChevronLeft size={16} />
          Back
        </button>
        <div className="h-4 w-px bg-gray-200" />
        <h1 className="text-2xl font-bold text-gray-900 flex-1">{locationName} — Inventory</h1>

        {/* Timer */}
        {!timerStarted ? (
          <button
            onClick={startTimer}
            className="flex items-center gap-2 bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#2E7D32] transition-colors"
          >
            <Play size={14} />
            Start Timer
          </button>
        ) : (
          <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
            <Timer size={15} className={timerRunning ? 'text-[#1B5E20]' : 'text-gray-400'} />
            <span className="text-base font-mono font-bold text-gray-800 tabular-nums min-w-[52px]">
              {formatTimer(elapsedSeconds)}
            </span>
            {timerRunning ? (
              <button
                onClick={pauseTimer}
                className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 font-medium ml-1"
              >
                <Pause size={13} />
                Pause
              </button>
            ) : (
              <button
                onClick={resumeTimer}
                className="flex items-center gap-1 text-xs text-[#1B5E20] hover:text-[#2E7D32] font-medium ml-1"
              >
                <Play size={13} />
                Resume
              </button>
            )}
          </div>
        )}
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

      {draftLoaded && (
        <div className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-xl px-4 py-2 mb-3 text-xs text-blue-700">
          <span>Draft restored from last session</span>
          <button
            onClick={() => { setCounts({}); setComment(''); setDraftLoaded(false); clearDraft(params.locationId); }}
            className="text-blue-500 hover:text-blue-700 font-medium"
          >
            Clear
          </button>
        </div>
      )}

      {/* Sections */}
      <div className="flex-1 space-y-4">
        {SECTIONS.map((section) => (
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
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={counts[item.name] ?? ''}
                    onChange={(e) => handleChange(item.name, e.target.value)}
                    placeholder="0"
                    className="w-20 text-right border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] bg-gray-50"
                  />
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
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add any extra comments or notes for this inventory report…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B5E20] resize-none bg-gray-50"
            />
          </div>
        </div>
      </div>

      {/* Fixed bottom bar */}
      <div className="fixed bottom-0 left-0 md:left-60 right-0 bg-white border-t border-gray-200 px-4 md:px-6 py-3 flex items-center justify-between shadow-lg z-10">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 font-medium">
            {filledCount} / {TOTAL_ITEMS} items filled
          </span>
          {isOnline
            ? <span className="flex items-center gap-1 text-xs text-green-600"><Wifi size={12} /> Online</span>
            : <span className="flex items-center gap-1 text-xs text-amber-600"><WifiOff size={12} /> Offline</span>
          }
        </div>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="flex items-center gap-2 bg-[#1B5E20] text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-[#2E7D32] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send size={15} />
          {submitting ? 'Saving…' : isOnline ? 'Submit' : 'Save Offline'}
        </button>
      </div>
    </div>
  );
}
