'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-browser';
import { Building2, Factory, Pencil } from 'lucide-react';
import { useT } from '@/lib/i18n';

const LOCATION_COLORS: Record<string, string> = {
  Eschborn: '#1565C0',
  Taunus:   '#E65100',
  Westend:  '#6A1B9A',
  ZK:       '#2E7D32',
};

/** True if the submission is still within the edit window (until 09:00 the next calendar day) */
function isEditable(submittedAt: string): boolean {
  const deadline = new Date(submittedAt);
  deadline.setDate(deadline.getDate() + 1);
  deadline.setHours(9, 0, 0, 0);
  return new Date() < deadline;
}

type Loc = { id: string; name: string; type: string };

export default function AddInventoryPage() {
  const router = useRouter();
  const { t } = useT();

  const { data: locations, isLoading } = useQuery({
    queryKey: ['locations', 'active'],
    queryFn: async () => {
      const { data } = await supabase
        .from('locations')
        .select('id, name, type')
        .eq('is_active', true)
        .neq('name', 'ZK')
        .order('name');
      return (data ?? []) as Loc[];
    },
  });

  // Primary source: localStorage written immediately after submission (device-local, instant, no RLS)
  const [localRecent, setLocalRecent] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!locations?.length) return;
    const map: Record<string, string> = {};
    for (const loc of locations) {
      const submittedAt = localStorage.getItem(`yumas_recent_inv_${loc.id}`);
      if (submittedAt) {
        if (isEditable(submittedAt)) {
          map[loc.id] = submittedAt;
        } else {
          // Past deadline — clean up stale entry
          localStorage.removeItem(`yumas_recent_inv_${loc.id}`);
        }
      }
    }
    setLocalRecent(map);
  }, [locations]);

  // Fallback source: DB query (catches cross-device and post-localStorage-clear cases)
  const { data: dbRecent } = useQuery<Record<string, string>>({
    queryKey: ['my-editable-submissions'],
    staleTime: 0,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return {};

      const since = new Date();
      since.setHours(since.getHours() - 36);

      const { data } = await supabase
        .from('inventory_submissions')
        .select('location_id, submitted_at')
        .eq('submitted_by', user.id)
        .gte('submitted_at', since.toISOString())
        .is('deleted_at', null)
        .order('submitted_at', { ascending: false });

      if (!data?.length) return {};

      const map: Record<string, string> = {};
      for (const row of data) {
        if (!map[row.location_id] && isEditable(row.submitted_at)) {
          map[row.location_id] = row.submitted_at;
        }
      }
      return map;
    },
  });

  // Once DB has loaded, evict any localStorage entries for locations the server no longer
  // has an active submission for (e.g. user moved it to trash from another device/tab).
  useEffect(() => {
    if (!dbRecent || !locations?.length) return;
    for (const loc of locations) {
      if (localRecent[loc.id] && !dbRecent[loc.id]) {
        localStorage.removeItem(`yumas_recent_inv_${loc.id}`);
        setLocalRecent(prev => { const next = { ...prev }; delete next[loc.id]; return next; });
      }
    }
  }, [dbRecent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Merge: localStorage wins for instant feedback on same device; DB eviction above keeps it honest
  const recentByLocation: Record<string, string> = { ...(dbRecent ?? {}), ...localRecent };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">{t('inventory.add.title')}</h1>
      <p className="text-sm text-gray-500 mb-6">{t('inventory.add.selectLocation')}</p>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden max-w-lg">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-14 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : (
          (locations ?? []).map((loc, i, arr) => {
            const color    = LOCATION_COLORS[loc.name] ?? '#1B5E20';
            const isLast   = i === arr.length - 1;
            const Icon     = loc.type === 'production' ? Factory : Building2;
            const submittedAt = recentByLocation[loc.id];
            const timeStr  = submittedAt
              ? new Date(submittedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
              : null;

            return (
              <div key={loc.id} className={!isLast ? 'border-b border-gray-100' : ''}>
                {/* Main location row */}
                <button
                  onClick={() => router.push(`/inventory/add/${loc.id}?name=${encodeURIComponent(loc.name)}`)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: color + '18' }}
                  >
                    <Icon size={20} style={{ color }} />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">{loc.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {loc.type === 'production' ? t('sidebar.groups.supplyChain') : 'Restaurant'}
                    </div>
                  </div>
                  <svg className="text-gray-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>

                {/* Editable-submission banner */}
                {submittedAt && timeStr && (
                  <div className="mx-4 mb-3 flex items-center justify-between gap-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl">
                    <div className="flex items-center gap-2 min-w-0">
                      <Pencil size={13} className="text-amber-500 flex-shrink-0" />
                      <span className="text-xs text-amber-700 truncate">
                        Submitted at <strong>{timeStr}</strong> · editable until 09:00 tomorrow
                      </span>
                    </div>
                    <button
                      onClick={() => router.push(`/inventory/add/${loc.id}?name=${encodeURIComponent(loc.name)}`)}
                      className="flex-shrink-0 px-3 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg text-xs font-semibold transition-colors"
                    >
                      Edit
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
