'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Trash2, Pencil, X, Check, RotateCcw, AlertTriangle, Link2 } from 'lucide-react';
import { useT } from '@/lib/i18n';

type DataItem = { section: string; name: string; unit: string; quantity: number };

type SubmissionRow = {
  id: string;
  location_name: string;
  submitted_at: string;
  submitted_by: string | null;
  comment: string | null;
  data: DataItem[];
  edited_at: string | null;
  edited_by: string | null;
  original_data: DataItem[] | null;
  deleted_at: string | null;
  deleted_by: string | null;
  linked_delivery_date: string | null;
  submitterName?: string;
};

function groupBySection(data: DataItem[]) {
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

/** True if the submission is still within the edit window (until 09:00 the next calendar day) */
function isEditable(submittedAt: string): boolean {
  const deadline = new Date(submittedAt);
  deadline.setDate(deadline.getDate() + 1);
  deadline.setHours(9, 0, 0, 0);
  return new Date() < deadline;
}

/** YYYY-MM-DD in local time — used as grouping key */
function localDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA');
}

/** Human-readable day label: Today / Yesterday / Wednesday 28 Apr 2026 */
function dayLabel(iso: string, t: (key: string) => string): string {
  const d = new Date(iso);
  const todayKey = new Date().toLocaleDateString('en-CA');
  const yestDate = new Date(); yestDate.setDate(yestDate.getDate() - 1);
  const yestKey  = yestDate.toLocaleDateString('en-CA');
  const key      = d.toLocaleDateString('en-CA');
  if (key === todayKey) return t('inventory.counts.today');
  if (key === yestKey)  return t('inventory.counts.yesterday');
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
}

function toLocalDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Mon/Tue/Wed/Fri delivery dates spanning 7 days back → 14 days forward */
const DELIVERY_DOW = [1, 2, 3, 5]; // Mon=1 Tue=2 Wed=3 Fri=5
function getDeliveryDateOptions(): { date: string; label: string }[] {
  const today = new Date();
  const todayStr = toLocalDateStr(today);
  const results: { date: string; label: string }[] = [];
  const d = new Date(today);
  d.setDate(today.getDate() - 7);
  const end = new Date(today);
  end.setDate(today.getDate() + 14);
  while (d <= end) {
    if (DELIVERY_DOW.includes(d.getDay())) {
      const dateStr = toLocalDateStr(d);
      const lbl = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      results.push({ date: dateStr, label: dateStr === todayStr ? `Today — ${lbl}` : lbl });
    }
    d.setDate(d.getDate() + 1);
  }
  return results;
}

export default function CurrentInventoryPage() {
  const { t } = useT();
  const [locationFilter, setLocationFilter] = useState('all');
  const [expandedIds, setExpandedIds]       = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId]   = useState<string | null>(null);
  const [confirmPermDeleteId, setConfirmPermDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError]           = useState<string | null>(null);
  const [showTrash, setShowTrash]               = useState(false);
  const [editingId, setEditingId]           = useState<string | null>(null);
  const [editDraft, setEditDraft]           = useState<Record<string, number>>({});
  const [editError, setEditError]           = useState<string | null>(null);
  const [linkingId, setLinkingId]           = useState<string | null>(null);

  // Current user identity & role — drives permission checks
  const [currentUserId, setCurrentUserId]   = useState<string | null>(null);
  const [isManager, setIsManager]           = useState<boolean | null>(null); // null = still loading

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { setIsManager(false); return; }
      setCurrentUserId(user.id);
      supabase.from('profiles').select('role').eq('id', user.id).single()
        .then(({ data }) => {
          const role = data?.role ?? '';
          setIsManager(role === 'admin' || role === 'manager');
        });
    });
  }, []);

  const queryClient = useQueryClient();

  // Soft-delete: move to trash
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('inventory_submissions')
        .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-submissions'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-trash'] });
      setConfirmDeleteId(null);
      setDeleteError(null);
    },
    onError: (err: any) => {
      setDeleteError(err?.message ?? 'Move to trash failed — you may not have permission.');
    },
  });

  // Restore from trash
  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('inventory_submissions')
        .update({ deleted_at: null, deleted_by: null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-submissions'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-trash'] });
    },
    onError: (err: any) => {
      setDeleteError(err?.message ?? 'Restore failed.');
    },
  });

  // Permanent delete (irreversible — from trash only)
  const permDeleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('inventory_submissions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-trash'] });
      setConfirmPermDeleteId(null);
    },
    onError: (err: any) => {
      setDeleteError(err?.message ?? 'Permanent delete failed.');
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({
      id,
      data,
      originalData,
      alreadyEdited,
      userId,
    }: {
      id: string;
      data: DataItem[];
      originalData: DataItem[];
      alreadyEdited: boolean;
      userId: string | null;
    }) => {
      const updatePayload: Record<string, unknown> = {
        data,
        edited_at: new Date().toISOString(),
        edited_by: userId,
      };
      // Only store original_data once — preserves the true original across multiple edits
      if (!alreadyEdited) {
        updatePayload.original_data = originalData;
      }
      const { data: updated, error } = await supabase
        .from('inventory_submissions')
        .update(updatePayload)
        .eq('id', id)
        .select('id');
      if (error) throw error;
      if (!updated || updated.length === 0) {
        throw new Error('Permission denied — RLS policy blocked the update. Run the staff-update SQL fix in Supabase.');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-submissions'] });
      setEditingId(null);
      setEditDraft({});
      setEditError(null);
    },
    onError: (err: unknown) => {
      setEditError(err instanceof Error ? err.message : 'Save failed — you may not have permission to edit this submission.');
    },
  });

  const linkMutation = useMutation({
    mutationFn: async ({ id, date }: { id: string; date: string | null }) => {
      const { error } = await supabase
        .from('inventory_submissions')
        .update({ linked_delivery_date: date })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-submissions'] });
      setLinkingId(null);
    },
  });

  const deliveryDateOptions = getDeliveryDateOptions();

  // Date range — default: last 90 days
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
    queryKey: ['inventory-submissions', locationFilter, fromDate, toDate, isManager, currentUserId],
    enabled: isManager !== null,
    queryFn: async () => {
      let q = supabase
        .from('inventory_submissions')
        .select('id, location_name, submitted_at, submitted_by, duration_seconds, data, comment, edited_at, edited_by, original_data, deleted_at, deleted_by, linked_delivery_date')
        .is('deleted_at', null)  // exclude soft-deleted
        .gte('submitted_at', `${fromDate}T00:00:00`)
        .lte('submitted_at', `${toDate}T23:59:59`)
        .order('submitted_at', { ascending: false })
        .limit(2000);
      if (locationFilter !== 'all') q = q.eq('location_name', locationFilter);
      if (!isManager && currentUserId) q = q.eq('submitted_by', currentUserId);
      const { data, error } = await q;
      if (error) throw error;

      const rows = data ?? [];
      const userIds = [...new Set(rows.map((r) => r.submitted_by).filter(Boolean))] as string[];
      let profileMap: Record<string, string> = {};
      if (userIds.length) {
        const { data: profiles } = await supabase
          .from('profiles').select('id, full_name').in('id', userIds);
        for (const p of profiles ?? []) profileMap[p.id] = p.full_name;
      }
      return rows.map((r) => ({
        ...r,
        submitterName: r.submitted_by ? (profileMap[r.submitted_by] ?? 'Unknown') : 'Unknown',
      })) as (SubmissionRow & { submitterName: string; duration_seconds?: number | null })[];
    },
  });

  // Trash query — managers only, all soft-deleted records
  const { data: trashItems, isLoading: trashLoading } = useQuery({
    queryKey: ['inventory-trash', isManager, currentUserId],
    enabled: isManager === true, // always fetch so the count badge is accurate
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_submissions')
        .select('id, location_name, submitted_at, submitted_by, duration_seconds, data, comment, edited_at, edited_by, original_data, deleted_at, deleted_by, linked_delivery_date')
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false })
        .limit(500);
      if (error) throw error;

      const rows = data ?? [];
      const userIds = [...new Set([
        ...rows.map((r) => r.submitted_by),
        ...rows.map((r) => r.deleted_by),
      ].filter(Boolean))] as string[];
      let profileMap: Record<string, string> = {};
      if (userIds.length) {
        const { data: profiles } = await supabase
          .from('profiles').select('id, full_name').in('id', userIds);
        for (const p of profiles ?? []) profileMap[p.id] = p.full_name;
      }
      return rows.map((r) => ({
        ...r,
        submitterName: r.submitted_by ? (profileMap[r.submitted_by] ?? 'Unknown') : 'Unknown',
        deleterName:   r.deleted_by   ? (profileMap[r.deleted_by]   ?? 'Unknown') : 'Unknown',
      })) as (SubmissionRow & { submitterName: string; deleterName: string; duration_seconds?: number | null })[];
    },
  });

  const trashCount = trashItems?.length ?? 0;

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const startEdit = (sub: SubmissionRow) => {
    const draft: Record<string, number> = {};
    for (const item of sub.data ?? []) draft[item.name] = item.quantity;
    setEditDraft(draft);
    setEditingId(sub.id);
    setEditError(null);
    setExpandedIds((prev) => { const next = new Set(prev); next.add(sub.id); return next; });
  };

  const saveEdit = (sub: SubmissionRow) => {
    const updatedData = (sub.data ?? []).map((item) => ({
      ...item,
      quantity: editDraft[item.name] ?? item.quantity,
    }));
    editMutation.mutate({
      id: sub.id,
      data: updatedData,
      originalData: sub.data,
      alreadyEdited: !!sub.edited_at,
      userId: currentUserId,
    });
  };

  /** Current user may edit this submission if the window is open and they own it (or are manager) */
  const canEdit = (sub: SubmissionRow): boolean => {
    if (!isEditable(sub.submitted_at)) return false;
    if (isManager) return true;
    return sub.submitted_by === currentUserId;
  };

  // Unique location names for filter dropdown
  const locationNames = [...new Set((locations as { id: string; name: string }[] ?? []).map((l) => l.name))];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('inventory.counts.title')}</h1>
        {isManager && (
          <button
            onClick={() => { setShowTrash(v => !v); setDeleteError(null); setConfirmPermDeleteId(null); }}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
              showTrash
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Trash2 size={14} />
            Trash
            {!showTrash && trashCount > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 text-red-600 text-xs font-bold">
                {trashCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* ── Trash view ── */}
      {showTrash && isManager && (
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
            <AlertTriangle size={16} className="text-red-500 flex-shrink-0" />
            <div className="flex-1 text-sm text-red-700">
              <strong>Trash bin</strong> — reports moved here are hidden from the main list.
              Restore them to make them visible again, or delete permanently (irreversible).
            </div>
          </div>

          {trashLoading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />)}</div>
          ) : !trashItems || trashItems.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-100 p-8 text-center text-gray-400 text-sm">
              Trash is empty — no deleted reports.
            </div>
          ) : (
            <div className="space-y-2">
              {trashItems.map((sub) => {
                const totalFilled = (sub.data ?? []).filter(i => i.quantity > 0).length;
                const totalItems  = (sub.data ?? []).length;
                const isConfirmingPerm = confirmPermDeleteId === sub.id;
                return (
                  <div key={sub.id} className="bg-white rounded-lg border border-red-100 shadow-sm overflow-hidden opacity-75">
                    <div className="flex items-center gap-3 px-4 py-3.5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-700 text-sm">{sub.location_name}</span>
                          <span className="text-xs text-gray-400">·</span>
                          <span className="text-xs text-gray-500">{sub.submitterName}</span>
                          <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-semibold">Deleted</span>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          Submitted {new Date(sub.submitted_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          {sub.deleted_at && (
                            <span className="ml-2 text-red-400">
                              · moved to trash {new Date(sub.deleted_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              {(sub as any).deleterName ? ` by ${(sub as any).deleterName}` : ''}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">{totalFilled}/{totalItems} filled</span>

                      {/* Restore */}
                      <button
                        onClick={() => restoreMutation.mutate(sub.id)}
                        disabled={restoreMutation.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors disabled:opacity-50 flex-shrink-0"
                      >
                        <RotateCcw size={12} /> Restore
                      </button>

                      {/* Permanent delete */}
                      {isConfirmingPerm ? (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <span className="text-xs text-red-600 font-medium">Sure?</span>
                          <button
                            onClick={() => permDeleteMutation.mutate(sub.id)}
                            disabled={permDeleteMutation.isPending}
                            className="px-2.5 py-1 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                          >
                            {permDeleteMutation.isPending ? 'Deleting…' : 'Yes, delete'}
                          </button>
                          <button
                            onClick={() => setConfirmPermDeleteId(null)}
                            className="px-2 py-1 text-xs text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmPermDeleteId(sub.id)}
                          className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                          title="Delete permanently"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4 border-t border-gray-100 pt-4">
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-widest">Main list</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-center gap-4">
        {isManager && (
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
        )}

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

      {isLoading || isManager === null ? (
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
                      const isExpanded        = expandedIds.has(sub.id);
                      const sections          = groupBySection(sub.data ?? []);
                      const totalFilled       = (sub.data ?? []).filter((i) => i.quantity > 0).length;
                      const totalItems        = (sub.data ?? []).length;
                      const isEditing         = editingId === sub.id;
                      const isConfirmingDelete = confirmDeleteId === sub.id;
                      const editable          = canEdit(sub);
                      const wasEdited         = !!sub.edited_at;

                      return (
                        <div key={sub.id} className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                          {/* Card header */}
                          <div className="flex items-center gap-2 px-4 py-3.5 hover:bg-gray-50 transition-colors">
                            <button
                              onClick={() => toggleExpand(sub.id)}
                              className="flex-1 min-w-0 flex items-center gap-4 text-left"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-gray-900 text-sm">{sub.location_name}</span>
                                  <span className="text-xs text-gray-400">·</span>
                                  <span className="text-xs text-gray-500">{sub.submitterName}</span>
                                  {wasEdited && (
                                    <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                                      Edited
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-400 mt-0.5">
                                  {new Date(sub.submitted_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                                  {wasEdited && sub.edited_at && (
                                    <span className="ml-2 text-amber-500">
                                      · edited {new Date(sub.edited_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  )}
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
                              ) : editable ? (
                                <button
                                  onClick={() => startEdit(sub)}
                                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                  title="Edit submission"
                                >
                                  <Pencil size={14} />
                                </button>
                              ) : null}


                              {/* Delete — managers only */}
                              {isManager && (
                                isConfirmingDelete ? (
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
                                      {deleteMutation.isPending ? 'Moving…' : 'Move to Trash'}
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
                                    title="Move to trash"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                )
                              )}
                            </div>
                          </div>

                          {/* Delivery link strip — managers only, always visible */}
                          {isManager && (
                            sub.linked_delivery_date ? (
                              /* ── Linked state ── */
                              <div className="flex items-center justify-between px-4 py-2.5 bg-blue-50 border-t border-blue-100">
                                <div className="flex items-center gap-2">
                                  <Link2 size={14} className="text-blue-500 flex-shrink-0" />
                                  <span className="text-sm font-semibold text-blue-700">
                                    Linked to delivery:{' '}
                                    <span className="font-bold">
                                      {new Date(sub.linked_delivery_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                                    </span>
                                  </span>
                                </div>
                                <button
                                  onClick={() => linkMutation.mutate({ id: sub.id, date: null })}
                                  disabled={linkMutation.isPending}
                                  className="text-xs text-blue-400 hover:text-red-500 font-medium transition-colors flex-shrink-0"
                                >
                                  {linkMutation.isPending ? 'Saving…' : 'Remove link'}
                                </button>
                              </div>
                            ) : linkingId === sub.id ? (
                              /* ── Picker open ── */
                              <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-t border-gray-100">
                                <Link2 size={14} className="text-gray-400 flex-shrink-0" />
                                <span className="text-sm text-gray-500 font-medium">Link to delivery:</span>
                                <select
                                  autoFocus
                                  defaultValue=""
                                  onChange={(e) => {
                                    if (e.target.value) linkMutation.mutate({ id: sub.id, date: e.target.value });
                                    setLinkingId(null);
                                  }}
                                  onBlur={() => setLinkingId(null)}
                                  className="flex-1 text-sm border border-blue-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                                >
                                  <option value="">Select delivery date…</option>
                                  {deliveryDateOptions.map(({ date, label }) => (
                                    <option key={date} value={date}>{label}</option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => setLinkingId(null)}
                                  className="text-xs text-gray-400 hover:text-gray-600 font-medium transition-colors flex-shrink-0"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              /* ── Not linked state ── */
                              <button
                                onClick={() => setLinkingId(sub.id)}
                                className="w-full flex items-center gap-2 px-4 py-2.5 border-t border-dashed border-gray-200 hover:bg-gray-50 transition-colors group"
                              >
                                <Link2 size={14} className="text-gray-300 group-hover:text-[#1B5E20] flex-shrink-0 transition-colors" />
                                <span className="text-sm text-gray-400 group-hover:text-[#1B5E20] font-medium transition-colors">
                                  Not linked to any delivery — tap to link
                                </span>
                              </button>
                            )
                          )}

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
                                <div className="px-4 py-3 border-t border-blue-100 bg-blue-50 space-y-2">
                                  {editError && (
                                    <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                                      {editError}
                                    </div>
                                  )}
                                  <div className="flex gap-2 justify-end">
                                    <button
                                      onClick={() => { setEditingId(null); setEditDraft({}); setEditError(null); }}
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
