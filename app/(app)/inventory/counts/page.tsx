'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useState } from 'react';
import { ChevronDown, ChevronRight, Trash2, Pencil, X, Check } from 'lucide-react';
import { useT } from '@/lib/i18n';

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
function dayLabel(iso: string, t: (key: string) => string): string {
  const d = new Date(iso);
  const todayKey   = new Date().toLocaleDateString('en-CA');
  const yestDate   = new Date(); yestDate.setDate(yestDate.getDate() - 1);
  const yestKey    = yestDate.toLocaleDateString('en-CA');
  const key        = d.toLocaleDateString('en-CA');
  if (key === todayKey) return t('inventory.counts.today');
  if (key === yestKey)  return t('inventory.counts.yesterday');
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
}

function toLocalDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function CurrentInventoryPage() {
  const { t } = useT();
  const [locationFilter, setLocationFilter] = useState('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, number>>({});

  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('inventory_submissions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-submissions'] });
      setConfirmDeleteId(null);
      setDeleteError(null);
    },
    onError: (err: any) => {
      setDeleteError(err?.message ?? 'Delete failed — you may not have permission.');
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { section: string; name: string; unit: string; quantity: number }[] }) => {
      const { error } = await supabase.from('inventory_submissions').update({ data }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-submissions'] });
      setEditingId(null);
      setEditDraft({});
    },
  });

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

  const startEdit = (sub: { id: string; data: { section: string; name: string; unit: string; quantity: number }[] }) => {
    const draft: Record<string, number> = {};
    for (const item of sub.data ?? []) draft[item.name] = item.quantity;
    setEditDraft(draft);
    setEditingId(sub.id);
    // Make sure the card is expanded when editing
    setExpandedIds((prev) => { const next = new Set(prev); next.add(sub.id); return next; });
  };

  const saveEdit = (sub: { id: string; data: { section: string; name: string; unit: string; quantity: number }[] }) => {
    const updatedData = (sub.data ?? []).map((item) => ({
      ...item,
      quantity: editDraft[item.name] ?? item.quantity,
    }));
    editMutation.mutate({ id: sub.id, data: updatedData });
  };

  // Unique location names for filter
  const locationNames = [...new Set((locations as { id: string; name: string }[] ?? []).map((l) => l.name))];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('inventory.counts.title')}</h1>
      </div>

      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">{t('inventory.counts.locationFilter')}</label>
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
          >
            <option value="all">{t('inventory.counts.allLocations')}</option>
            {locationNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">{t('inventory.counts.from')}</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]" />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">{t('inventory.counts.to')}</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]" />
        </div>

        <button
          onClick={() => { setFromDate(defaultFrom); setToDate(defaultTo); }}
          className="text-xs text-[#1B5E20] hover:underline font-medium"
        >
          {t('inventory.counts.resetDays')}
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
          {t('inventory.counts.noSubmissions')}
        </div>
      ) : (() => {
          // Group submissions by local date
          const groups: { key: string; label: string; subs: typeof submissions }[] = [];
          for (const sub of submissions) {
            const key = localDateKey(sub.submitted_at);
            const last = groups[groups.length - 1];
            if (!last || last.key !== key) {
              groups.push({ key, label: dayLabel(sub.submitted_at, t), subs: [sub] });
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
                    <span className="text-xs text-gray-300">{subs.length} {subs.length !== 1 ? t('inventory.counts.reports') : t('inventory.counts.report')}</span>
                  </div>

                  {/* Cards for this day */}
                  <div className="space-y-2">
                    {subs.map((sub) => {
                      const isExpanded = expandedIds.has(sub.id);
                      const sections = groupBySection(sub.data ?? []);
                      const totalFilled = (sub.data ?? []).filter((i: { quantity: number }) => i.quantity > 0).length;
                      const totalItems = (sub.data ?? []).length;

                        const isEditing = editingId === sub.id;
                      const isConfirmingDelete = confirmDeleteId === sub.id;

                      return (
                        <div key={sub.id} className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                          {/* Card header */}
                          <div className="flex items-center gap-2 px-4 py-3.5 hover:bg-gray-50 transition-colors">
                            <button
                              onClick={() => toggleExpand(sub.id)}
                              className="flex-1 min-w-0 flex items-center gap-4 text-left"
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
                                <span className="text-xs text-gray-500">{totalFilled}/{totalItems} {t('inventory.counts.filled')}</span>
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

                            {/* Action buttons */}
                            <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                              {isEditing ? (
                                <>
                                  <button
                                    onClick={() => saveEdit(sub)}
                                    disabled={editMutation.isPending}
                                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-[#2E7D32] rounded-lg hover:bg-[#1B5E20] disabled:opacity-50 transition-colors"
                                  >
                                    <Check size={12} /> {t('common.save')}
                                  </button>
                                  <button
                                    onClick={() => { setEditingId(null); setEditDraft({}); }}
                                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                                  >
                                    <X size={12} /> {t('common.cancel')}
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => startEdit(sub)}
                                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                  title="Edit report"
                                >
                                  <Pencil size={14} />
                                </button>
                              )}

                              {isConfirmingDelete ? (
                                <>
                                  {deleteError && confirmDeleteId === sub.id && (
                                    <span className="text-xs text-red-500 mr-1 max-w-[180px] truncate" title={deleteError}>
                                      {deleteError}
                                    </span>
                                  )}
                                  <button
                                    onClick={() => { setDeleteError(null); deleteMutation.mutate(sub.id); }}
                                    disabled={deleteMutation.isPending}
                                    className="px-2.5 py-1 text-xs font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors"
                                  >
                                    {deleteMutation.isPending ? t('inventory.counts.deleting') : t('inventory.counts.yesDelete')}
                                  </button>
                                  <button
                                    onClick={() => { setConfirmDeleteId(null); setDeleteError(null); }}
                                    className="px-2.5 py-1 text-xs font-semibold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                                  >
                                    {t('common.cancel')}
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => setConfirmDeleteId(sub.id)}
                                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                  title="Delete report"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Expanded detail */}
                          {isExpanded && (
                            <div className="border-t border-gray-100">
                              {isEditing && (
                                <div className="px-4 py-2 bg-blue-50 border-b border-blue-100">
                                  <p className="text-xs font-semibold text-blue-700">{t('inventory.counts.editing')}</p>
                                </div>
                              )}
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
                                      {isEditing ? (
                                        <input
                                          type="number"
                                          min="0"
                                          step="0.01"
                                          value={editDraft[item.name] ?? item.quantity}
                                          onChange={(e) => setEditDraft((prev) => ({ ...prev, [item.name]: parseFloat(e.target.value) || 0 }))}
                                          className="w-24 text-right text-sm font-semibold border border-blue-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400 tabular-nums"
                                        />
                                      ) : (
                                        <span className={`text-sm font-semibold tabular-nums ${item.quantity > 0 ? 'text-[#2E7D32]' : 'text-gray-300'}`}>
                                          {item.quantity}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ))}
                              {(sub as any).comment && (
                                <div className="px-4 py-3 bg-amber-50 border-t border-amber-100">
                                  <p className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-1">{t('inventory.counts.comment')}</p>
                                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{(sub as any).comment}</p>
                                </div>
                              )}
                              {isEditing && (
                                <div className="px-4 py-3 border-t border-blue-100 bg-blue-50 flex gap-2 justify-end">
                                  <button
                                    onClick={() => { setEditingId(null); setEditDraft({}); }}
                                    className="px-3 py-1.5 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                                  >
                                    {t('common.cancel')}
                                  </button>
                                  <button
                                    onClick={() => saveEdit(sub)}
                                    disabled={editMutation.isPending}
                                    className="px-3 py-1.5 text-xs font-semibold text-white bg-[#2E7D32] rounded-lg hover:bg-[#1B5E20] disabled:opacity-50 transition-colors"
                                  >
                                    {editMutation.isPending ? t('common.saving') : t('inventory.counts.saveChanges')}
                                  </button>
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
