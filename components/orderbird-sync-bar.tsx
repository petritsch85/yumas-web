'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MousePointerClick, CheckCircle2, AlertTriangle, Clock, Loader2, Bookmark } from 'lucide-react';
import { supabase } from '@/lib/supabase-browser';

type SyncRun = {
  ran_at:         string;
  ok:             boolean;
  imported_count: number;
  error:          string | null;
  /** Worked out when fetched (and refetched every minute), not while rendering. */
  stale:          boolean;
};

/** After this long without an import, the bar turns orange as a reminder. */
const STALE_HOURS = 48;

const when = (iso: string) => new Date(iso).toLocaleString('de-DE', {
  weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

/**
 * The "Yumas Import" bookmark: when it was last clicked, what it brought in,
 * and how to set it up. MY orderbird blocks requests from servers, so the
 * Z-reports are fetched by the bookmark inside the user's own logged-in tab
 * (public/orderbird-import.js).
 */
export function OrderbirdSyncBar() {
  const [setupOpen, setSetupOpen] = useState(false);
  const [token, setToken]         = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);

  const { data: last, isFetched } = useQuery<SyncRun | null>({
    queryKey: ['orderbird-sync-last'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orderbird_sync_runs')
        .select('ran_at, ok, imported_count, error')
        .order('ran_at', { ascending: false })
        .limit(1);
      if (error) return null; // the table arrives with supabase/add_orderbird_sync.sql
      const row = data?.[0] as Omit<SyncRun, 'stale'> | undefined;
      if (!row) return null;
      return { ...row, stale: Date.now() - new Date(row.ran_at).getTime() > STALE_HOURS * 3600_000 };
    },
    refetchInterval: 60_000,
  });

  /* React refuses a javascript: href, so it is set on the element directly.
     The timestamp makes the browser load the script fresh on every click. */
  useEffect(() => {
    if (!token || !linkRef.current) return;
    const src = `${window.location.origin}/orderbird-import.js?t=${token}&v=`;
    linkRef.current.setAttribute('href',
      `javascript:(function(){var s=document.createElement('script');s.src='${src}'+Date.now();document.body.appendChild(s);})()`);
  }, [token, setupOpen]);

  const openSetup = async () => {
    setSetupOpen(o => !o);
    if (token) return;
    setSetupError(null);
    const res = await fetch('/api/orderbird-import/token', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.token) setToken(body.token);
    else setSetupError(body.error ?? 'Could not set up the button.');
  };

  const stale = isFetched && (!last || last.stale);
  const tone = last && !last.ok ? 'border-red-200 bg-red-50/70'
    : stale ? 'border-amber-300 bg-amber-50'
    : 'border-green-200 bg-green-50/60';

  return (
    <div className={`mb-5 px-4 py-2.5 rounded-xl border text-sm ${tone}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex-shrink-0">
          {last && !last.ok ? <AlertTriangle size={15} className="text-red-500" />
            : stale ? <Clock size={15} className="text-amber-600" />
            : <CheckCircle2 size={15} className="text-green-600" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-800">
            Orderbird import
            <span className="font-normal text-gray-500"> · open MY orderbird and click <b>Yumas Import</b> in your bookmarks bar — fetches every missing shift for all three restaurants</span>
          </p>
          <p className={`text-xs mt-0.5 ${last && !last.ok ? 'text-red-600' : stale ? 'text-amber-700 font-semibold' : 'text-gray-500'}`}>
            {!last ? 'Not run yet.'
              : !last.ok ? `Last import ${when(last.ran_at)} had a problem: ${last.error}`
              : `Last import ${when(last.ran_at)} · ${last.imported_count} new shift${last.imported_count === 1 ? '' : 's'}${stale ? ' — time for the next one' : ''}`}
          </p>
        </div>
        <button onClick={openSetup}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 border border-gray-200 bg-white rounded-lg hover:bg-gray-50 transition-colors">
          <Bookmark size={12} />
          Set up button
        </button>
      </div>

      {setupOpen && (
        <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-600 space-y-2">
          {setupError ? <p className="text-red-600">{setupError}</p>
            : !token ? <p className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />Preparing…</p>
            : (
              <>
                <p>
                  1. Show your bookmarks bar (<b>Ctrl+Shift+B</b>).{' '}
                  2. Drag this green button onto it:{' '}
                  <a ref={linkRef} onClick={e => { e.preventDefault(); alert('Drag this button onto your bookmarks bar — clicking it here does nothing.'); }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 ml-1 rounded-lg bg-[#1B5E20] text-white font-bold cursor-grab">
                    <MousePointerClick size={12} />Yumas Import
                  </a>
                </p>
                <p>3. From then on: open <b>my.orderbird.com</b>, make sure you are logged in, click <b>Yumas Import</b>. A box shows what was imported.</p>
                <p className="text-gray-400">The button carries its own access key — set it up only in your own browser.</p>
              </>
            )}
        </div>
      )}
    </div>
  );
}
