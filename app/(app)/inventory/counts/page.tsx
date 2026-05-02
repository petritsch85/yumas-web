'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

type SubmissionRow = {
  id: string;
  location_name: string;
  submitted_at: string;
  submitted_by: string | null;
  comment: string | null;
  data: { section: string; name: string; unit: string; quantity: number }[];
  profile: { full_name: string } | null;
};

function groupBySection(data: SubmissionRow['data']) {
  const map: Record<string, { name: string; unit: string; quantity: number }[]> = {};
  for (const item of data) {
    if (!map[item.section]) map[item.section] = [];
    map[item.section].push({ name: item.name, unit: item.unit, quantity: item.quantity });
  }
  return map;
}

function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** YYYY-MM-DD in local time — used as grouping key */
function localDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA'); // en-CA gives YYYY-MM-DD
}

/** Human-readable day label: Today / Yesterday / Wednesday 28 Apr 2026 */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const todayKey   = new Date().toLocaleDateString('en-CA');
  const yestDate   = new Date(); yestDate.setDate(yestDate.getDate() - 1);
  const yestKey    = yestDate.toLocaleDateString('en-CA');
  const key        = d.toLocaleDateString('en-CA');
  if (key === todayKey) return 'Today';
  if (key === yestKey)  return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
}

function toLocalDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function CurrentInventoryPage() {
  const [locationFilter, setLocationFilter] = useState('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Date range — default: last 90 days (catches backdated Excel uploads)
  const defaultFrom = toLocalDateStr(new Date(Date.now() - 90 * 86_400_000));
  const defaultTo   = toLocalDateStr(new Date());
  const [fromDate, setFromDate] = useState(() => toLocalDateStr(new Date(Date.now() - 90 * 86_400_000)));
  const [toDate,   setToDate]   = useState(() => toLocalDateStr(new Date()));

  const { data: locations } = useQuery({
    queryKey: ['locations-list'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('id, name').order('name');
      return data ?? [];
    },
  });

  const { data: submissions, isLoading } = useQuery({
    queryKey: ['inventory-submissions', locationFilter, fromDate, toDate],
    queryFn: async () => {
      let q = supabase
        .from('inventory_submissions')
        .select('id, location_name, submitted_at, submitted_by, duration_seconds, data, comment')
        .gte('submitted_at', `${fromDate}T00:00:00`)
        .lte('submitted_at', `${toDate}T23:59:59`)
        .order('submitted_at', { ascending: false })
        .limit(2000);
      if (locationFilter !== 'all') q = q.eq('location_name', locationFilter);
      const { data, error } = await q;
      if (error) throw error;

      // Resolve submitter names
      const rows = data ?? [];
      const userIds = [...new Set(rows.map((r) => r.submitted_by).filter(Boolean))] as string[];
      let profileMap: Record<string, string> = {};
      if (userIds.length) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', userIds);
        for (const p of profiles ?? []) profileMap[p.id] = p.full_name;
      }

      return rows.map((r) => ({
        ...r,
        submitterName: r.submitted_by ? (profileMap[r.submitted_by] ?? 'Unknown') : 'Unknown',
      }));
    },
  });

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Unique location names for filter
  const locationNames = [...new Set((locations as { id: string; name: string }[] ?? []).map((l) => l.name))];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Inventory Reports</h1>
      </div>

      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Location:</label>
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
          >
            <option value="all">All Locations</option>
            {locationNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">From:</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]" />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">To:</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]" />
        </div>

        <button
          onClick={() => { setFromDate(defaultFrom); setToDate(defaultTo); }}
          className="text-xs text-[#1B5E20] hover:underline font-medium"
        >
          Reset to 90 days
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : !submissions || submissions.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-8 text-center text-gray-400 text-sm">
          No inventory submissions found
        </div>
      ) : (() => {
          // Group submissions by local date
          const groups: { key: string; label: string; subs: typeof submissions }[] = [];
          for (const sub of submissions) {
            const key = localDateKey(sub.submitted_at);
            const last = groups[groups.length - 1];
            if (!last || last.key !== key) {
              groups.push({ key, label: dayLabel(sub.submitted_at), subs: [sub] });
            } else {
              last.subs.push(sub);
            }
          }

          return (
            <div className="space-y-6">
              {groups.map(({ key, label, subs }) => (
                <div key={key}>
                  {/* Day header */}
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest whitespace-nowrap">
                      {label}
                    </span>
                    <div className="flex-1 h-px bg-gray-100" />
                    <span className="text-xs text-gray-300">{subs.length} report{subs.length !== 1 ? 's' : ''}</span>
                  </div>

                  {/* Cards for this day */}
                  <div className="space-y-2">
                    {subs.map((sub) => {
                      const isExpanded = expandedIds.has(sub.id);
                      const sections = groupBySection(sub.data ?? []);
                      const totalFilled = (sub.data ?? []).filter((i: { quantity: number }) => i.quantity > 0).length;
                      const totalItems = (sub.data ?? []).length;

                      return (
                        <div key={sub.id} className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                          {/* Card header */}
                          <button
                            onClick={() => toggleExpand(sub.id)}
                            className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-gray-900 text-sm">{sub.location_name}</span>
                                <span className="text-xs text-gray-400">·</span>
                                <span className="text-xs text-gray-500">{sub.submitterName}</span>
                              </div>
                              <div className="text-xs text-gray-400 mt-0.5">
                                {new Date(sub.submitted_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <span className="text-xs text-gray-500">{totalFilled}/{totalItems} filled</span>
                              {formatDuration((sub as any).duration_seconds) && (
                                <span className="text-xs font-semibold text-[#2E7D32] bg-green-50 px-2 py-0.5 rounded-full">
                                  ⏱ {formatDuration((sub as any).duration_seconds)}
                                </span>
                              )}
                            </div>
                            {isExpanded
                              ? <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />
                              : <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
                            }
                          </button>

                          {/* Expanded detail */}
                          {isExpanded && (
                            <div className="border-t border-gray-100">
                              {Object.entries(sections).map(([sectionTitle, items]) => (
                                <div key={sectionTitle}>
                                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{sectionTitle}</span>
                                  </div>
                                  {items.map((item, idx) => (
                                    <div
                                      key={item.name}
                                      className={`flex items-center gap-4 px-4 py-2.5 ${idx < items.length - 1 ? 'border-b border-gray-50' : ''}`}
                                    >
                                      <div className="flex-1 min-w-0">
                                        <span className="text-sm text-gray-800">{item.name}</span>
                                        <span className="text-xs text-gray-400 ml-2">{item.unit}</span>
                                      </div>
                                      <span className={`text-sm font-semibold tabular-nums ${item.quantity > 0 ? 'text-[#2E7D32]' : 'text-gray-300'}`}>
                                        {item.quantity}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ))}
                              {(sub as any).comment && (
                                <div className="px-4 py-3 bg-amber-50 border-t border-amber-100">
                                  <p className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-1">Comment</p>
                                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{(sub as any).comment}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })()
      }
    </div>
  );
}
