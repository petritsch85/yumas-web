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

export default function CurrentInventoryPage() {
  const [locationFilter, setLocationFilter] = useState('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const { data: locations } = useQuery({
    queryKey: ['locations-list'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('id, name').order('name');
      return data ?? [];
    },
  });

  const { data: submissions, isLoading } = useQuery({
    queryKey: ['inventory-submissions', locationFilter],
    queryFn: async () => {
      let q = supabase
        .from('inventory_submissions')
        .select('id, location_name, submitted_at, submitted_by, duration_seconds, data')
        .order('submitted_at', { ascending: false });
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
        <h1 className="text-2xl font-bold text-gray-900">Current Inventory</h1>
      </div>

      {/* Location filter */}
      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Location:</label>
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
      ) : (
        <div className="space-y-2">
          {submissions.map((sub) => {
            const isExpanded = expandedIds.has(sub.id);
            const sections = groupBySection(sub.data ?? []);
            const totalFilled = (sub.data ?? []).filter((i: { quantity: number }) => i.quantity > 0).length;
            const totalItems = (sub.data ?? []).length;

            return (
              <div key={sub.id} className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                {/* Card header — click to expand */}
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
                    <div className="text-xs text-gray-400 mt-0.5">{formatDate(sub.submitted_at)}</div>
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
