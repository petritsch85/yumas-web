'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  Plus, ChevronDown, ChevronRight, Clock, Trash2, Save, X, ToggleLeft, ToggleRight, Copy,
} from 'lucide-react';
import { useState } from 'react';

/* ── Types ───────────────────────────────────────────────────────────────── */
type Location = {
  id: string;
  name: string;
  type: string | null;
  address: string | null;
  is_active: boolean;
};

type DayTime = { start: string; end: string };
type DayTimes = Partial<Record<string, DayTime>>;

type Shift = {
  id: string;
  location_id: string;
  name: string;
  day_times: DayTimes;
  is_active: boolean;
};

const ALL_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS: Record<string, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed',
  thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
};

/* Group days that share the same times and return a compact summary string */
function summariseDayTimes(dt: DayTimes): string {
  const days = ALL_DAYS.filter(d => dt[d]);
  if (!days.length) return '—';

  // Group consecutive days with identical times
  type Group = { days: string[]; start: string; end: string };
  const groups: Group[] = [];
  for (const d of days) {
    const t = dt[d]!;
    const last = groups[groups.length - 1];
    if (last && last.start === t.start && last.end === t.end) {
      last.days.push(d);
    } else {
      groups.push({ days: [d], start: t.start, end: t.end });
    }
  }

  // Render each group
  return groups.map(g => {
    const dayStr =
      g.days.length === 1
        ? DAY_LABELS[g.days[0]]
        : `${DAY_LABELS[g.days[0]]}–${DAY_LABELS[g.days[g.days.length - 1]]}`;
    return `${dayStr} ${g.start}–${g.end}`;
  }).join(' · ');
}

/* ── Shift editor ────────────────────────────────────────────────────────── */
function ShiftRow({
  shift, locationId, onSaved, onDeleted,
}: {
  shift: Shift | null;
  locationId: string;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const isNew = !shift;
  const [editing, setEditing] = useState(isNew);
  const [name, setName] = useState(shift?.name ?? '');

  // Per-day state: enabled flag + start/end times
  const initDayTimes = (): Record<string, { enabled: boolean; start: string; end: string }> => {
    const result: Record<string, { enabled: boolean; start: string; end: string }> = {};
    for (const d of ALL_DAYS) {
      const existing = shift?.day_times?.[d];
      result[d] = {
        enabled: !!existing,
        start: existing?.start ?? '11:30',
        end: existing?.end ?? '22:30',
      };
    }
    return result;
  };

  const [dayState, setDayState] = useState(initDayTimes);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();

  const toggleDay = (d: string) =>
    setDayState(prev => ({ ...prev, [d]: { ...prev[d], enabled: !prev[d].enabled } }));

  const setDayField = (d: string, field: 'start' | 'end', val: string) =>
    setDayState(prev => ({ ...prev, [d]: { ...prev[d], [field]: val } }));

  /* Copy first enabled day's times to all other enabled days */
  const copyToAll = () => {
    const first = ALL_DAYS.find(d => dayState[d].enabled);
    if (!first) return;
    const { start, end } = dayState[first];
    setDayState(prev => {
      const next = { ...prev };
      for (const d of ALL_DAYS) {
        if (next[d].enabled) next[d] = { ...next[d], start, end };
      }
      return next;
    });
  };

  const toggleActive = async () => {
    if (!shift) return;
    await supabase.from('location_shifts').update({ is_active: !shift.is_active }).eq('id', shift.id);
    qc.invalidateQueries({ queryKey: ['location_shifts', locationId] });
  };

  const handleSave = async () => {
    const enabledDays = ALL_DAYS.filter(d => dayState[d].enabled);
    if (!name.trim() || !enabledDays.length) return;
    setSaving(true);
    const day_times: DayTimes = {};
    for (const d of enabledDays) {
      day_times[d] = { start: dayState[d].start, end: dayState[d].end };
    }
    if (isNew) {
      await supabase.from('location_shifts').insert({ location_id: locationId, name: name.trim(), day_times });
    } else {
      await supabase.from('location_shifts').update({
        name: name.trim(), day_times, updated_at: new Date().toISOString(),
      }).eq('id', shift!.id);
    }
    setSaving(false);
    setEditing(false);
    qc.invalidateQueries({ queryKey: ['location_shifts', locationId] });
    onSaved();
  };

  const handleDelete = async () => {
    if (!shift) { onDeleted(); return; }
    setDeleting(true);
    await supabase.from('location_shifts').delete().eq('id', shift.id);
    setDeleting(false);
    qc.invalidateQueries({ queryKey: ['location_shifts', locationId] });
    onDeleted();
  };

  /* ── Read-only card ── */
  if (!editing && shift) {
    return (
      <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border transition-colors ${shift.is_active ? 'border-gray-100 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-gray-800 text-sm">{shift.name}</span>
            {!shift.is_active && (
              <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">Inactive</span>
            )}
          </div>
          {/* Per-day summary */}
          <div className="space-y-0.5">
            {ALL_DAYS.filter(d => shift.day_times?.[d]).map(d => (
              <div key={d} className="flex items-center gap-3 text-xs text-gray-400">
                <span className="w-8 font-medium text-gray-500">{DAY_LABELS[d]}</span>
                <span className="flex items-center gap-1">
                  <Clock size={10} />
                  {shift.day_times![d]!.start} – {shift.day_times![d]!.end}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
          <button onClick={toggleActive} title={shift.is_active ? 'Deactivate' : 'Activate'}
            className="p-1.5 rounded-md hover:bg-gray-100 transition-colors">
            {shift.is_active
              ? <ToggleRight size={18} className="text-[#1B5E20]" />
              : <ToggleLeft size={18} className="text-gray-300" />}
          </button>
          <button onClick={() => setEditing(true)}
            className="px-2.5 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
            Edit
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button onClick={handleDelete} disabled={deleting}
                className="px-2 py-1 rounded-md text-xs font-bold bg-red-100 text-red-600 hover:bg-red-200">
                {deleting ? '…' : 'Yes'}
              </button>
              <button onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 rounded-md text-xs font-bold bg-gray-100 text-gray-500 hover:bg-gray-200">
                No
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-md hover:bg-red-50 text-gray-200 hover:text-red-400 transition-colors">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ── Edit / new form ── */
  const anyEnabled = ALL_DAYS.some(d => dayState[d].enabled);

  return (
    <div className="border border-[#1B5E20]/20 rounded-lg bg-green-50/30 p-4 space-y-4">
      {/* Name row */}
      <div className="flex gap-2 items-center">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Shift name (e.g. Lunch, Dinner)"
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]/40"
        />
        <button onClick={() => { if (!isNew) setEditing(false); else onDeleted(); }}
          className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Per-day time grid */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Days &amp; Times</p>
          {anyEnabled && (
            <button onClick={copyToAll}
              className="flex items-center gap-1 text-xs text-[#1B5E20] hover:text-[#2E7D32] font-medium transition-colors">
              <Copy size={11} /> Copy first to all
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          {ALL_DAYS.map(d => {
            const ds = dayState[d];
            return (
              <div key={d} className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${ds.enabled ? 'bg-white border border-gray-100' : 'bg-transparent'}`}>
                {/* Toggle day */}
                <button onClick={() => toggleDay(d)}
                  className={`w-14 flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold border transition-colors ${
                    ds.enabled
                      ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                      : 'bg-white text-gray-400 border-gray-200 hover:border-[#1B5E20]/40'
                  }`}>
                  {DAY_LABELS[d]}
                </button>

                {ds.enabled ? (
                  <>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-400 w-7">From</span>
                      <input
                        type="time"
                        value={ds.start}
                        onChange={e => setDayField(d, 'start', e.target.value)}
                        className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 w-28"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-400 w-3">To</span>
                      <input
                        type="time"
                        value={ds.end}
                        onChange={e => setDayField(d, 'end', e.target.value)}
                        className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 w-28"
                      />
                    </div>
                  </>
                ) : (
                  <span className="text-xs text-gray-300 italic">Closed</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving || !name.trim() || !anyEnabled}
        className="flex items-center gap-1.5 px-4 py-1.5 bg-[#1B5E20] text-white text-sm font-medium rounded-lg hover:bg-[#2E7D32] transition-colors disabled:opacity-40"
      >
        <Save size={14} />
        {saving ? 'Saving…' : 'Save Shift'}
      </button>
    </div>
  );
}

/* ── Shifts panel ────────────────────────────────────────────────────────── */
function ShiftsPanel({ location }: { location: Location }) {
  const [addingNew, setAddingNew] = useState(false);

  const { data: shifts = [], isLoading } = useQuery<Shift[]>({
    queryKey: ['location_shifts', location.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('location_shifts').select('*')
        .eq('location_id', location.id).order('name');
      return (data ?? []) as Shift[];
    },
  });

  const active   = shifts.filter(s => s.is_active);
  const inactive = shifts.filter(s => !s.is_active);

  return (
    <div className="px-4 pb-5 pt-3 bg-gray-50 border-t border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          <Clock size={12} /> Shifts
        </span>
        {!addingNew && (
          <button onClick={() => setAddingNew(true)}
            className="flex items-center gap-1 text-xs font-semibold text-[#1B5E20] hover:text-[#2E7D32] transition-colors">
            <Plus size={13} /> Add Shift
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-2">
          {active.map(s => (
            <ShiftRow key={s.id} shift={s} locationId={location.id} onSaved={() => {}} onDeleted={() => {}} />
          ))}

          {inactive.length > 0 && (
            <>
              {active.length > 0 && <div className="border-t border-dashed border-gray-200 my-1" />}
              {inactive.map(s => (
                <ShiftRow key={s.id} shift={s} locationId={location.id} onSaved={() => {}} onDeleted={() => {}} />
              ))}
            </>
          )}

          {shifts.length === 0 && !addingNew && (
            <p className="text-xs text-gray-400 text-center py-3">No shifts defined yet.</p>
          )}

          {addingNew && (
            <ShiftRow
              shift={null}
              locationId={location.id}
              onSaved={() => setAddingNew(false)}
              onDeleted={() => setAddingNew(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────────────────── */
export default function LocationsPage() {
  const { data: locations, isLoading } = useQuery<Location[]>({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('*').order('name');
      return (data ?? []) as Location[];
    },
  });

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Locations</h1>
        <button className="bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors flex items-center gap-2">
          <Plus size={16} /> Add Location
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : !locations || locations.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No locations found</div>
        ) : (
          <div>
            {locations.map((loc, idx) => {
              const isOpen = expanded.has(loc.id);
              return (
                <div key={loc.id} className={idx > 0 ? 'border-t border-gray-100' : ''}>
                  <button onClick={() => toggle(loc.id)}
                    className="w-full text-left hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-3 px-4 py-3.5">
                      <div className="flex-shrink-0">
                        {isOpen
                          ? <ChevronDown size={16} className="text-[#1B5E20]" />
                          : <ChevronRight size={16} className="text-gray-300" />}
                      </div>
                      <div className="flex-1 grid grid-cols-[1.5fr_1fr_3fr_auto] gap-4 items-center text-sm">
                        <span className="font-semibold text-gray-900">{loc.name}</span>
                        <span className="text-gray-500 capitalize">{loc.type ?? '—'}</span>
                        <span className="text-gray-400 text-xs truncate">{loc.address ?? '—'}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${loc.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {loc.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                  </button>
                  {isOpen && <ShiftsPanel location={loc} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-4">
        Click any location to expand its shift schedule. Use the toggle to cancel / reinstate a shift without deleting it.
      </p>
    </div>
  );
}
