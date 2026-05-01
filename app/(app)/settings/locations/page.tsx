'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  Plus, ChevronDown, ChevronRight, Clock, Trash2, Save, X, ToggleLeft, ToggleRight,
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

type Shift = {
  id: string;
  location_id: string;
  name: string;
  days: string[];
  start_time: string;  // 'HH:MM'
  end_time: string;
  is_active: boolean;
};

const ALL_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS: Record<string, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed',
  thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
};

function fmtTime(t: string) {
  // 'HH:MM:SS' or 'HH:MM' → 'HH:MM'
  return t.slice(0, 5);
}

function fmtDays(days: string[]): string {
  if (!days.length) return '—';
  // Abbreviate consecutive runs
  const idxs = days.map(d => ALL_DAYS.indexOf(d)).sort((a, b) => a - b);
  const labels = idxs.map(i => DAY_LABELS[ALL_DAYS[i]]);
  // Check for Mon–Fri
  const monFri = [0, 1, 2, 3, 4];
  if (idxs.length === 5 && monFri.every((v, i) => idxs[i] === v)) return 'Mon – Fri';
  if (idxs.length === 6 && idxs.join() === '0,1,2,3,4,5') return 'Mon – Sat';
  if (idxs.length === 7) return 'Every day';
  if (idxs.length === 5 && idxs.join() === '1,2,3,4,5') return 'Tue – Sat';
  if (idxs.length === 6 && idxs.join() === '1,2,3,4,5,6') return 'Tue – Sun';
  return labels.join(', ');
}

/* ── Shift editor row ────────────────────────────────────────────────────── */
function ShiftRow({
  shift, locationId, onSaved, onDeleted,
}: {
  shift: Shift | null;  // null = new unsaved row
  locationId: string;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const isNew = !shift;
  const [editing, setEditing] = useState(isNew);
  const [name, setName] = useState(shift?.name ?? '');
  const [days, setDays] = useState<string[]>(shift?.days ?? []);
  const [start, setStart] = useState(shift ? fmtTime(shift.start_time) : '');
  const [end, setEnd]     = useState(shift ? fmtTime(shift.end_time) : '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const toggleDay = (d: string) =>
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);

  const qc = useQueryClient();

  const toggleActive = async () => {
    if (!shift) return;
    await supabase.from('location_shifts').update({ is_active: !shift.is_active }).eq('id', shift.id);
    qc.invalidateQueries({ queryKey: ['location_shifts', locationId] });
    onSaved();
  };

  const handleSave = async () => {
    if (!name.trim() || !days.length || !start || !end) return;
    setSaving(true);
    if (isNew) {
      await supabase.from('location_shifts').insert({
        location_id: locationId, name: name.trim(), days, start_time: start, end_time: end,
      });
    } else {
      await supabase.from('location_shifts').update({
        name: name.trim(), days, start_time: start, end_time: end, updated_at: new Date().toISOString(),
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

  /* ── Read-only row ── */
  if (!editing && shift) {
    return (
      <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${shift.is_active ? 'border-gray-100 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-800 text-sm">{shift.name}</span>
            {!shift.is_active && (
              <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">Inactive</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
            <span>{fmtDays(shift.days)}</span>
            <span className="flex items-center gap-1">
              <Clock size={11} /> {fmtTime(shift.start_time)} – {fmtTime(shift.end_time)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Active toggle */}
          <button
            onClick={toggleActive}
            title={shift.is_active ? 'Deactivate shift' : 'Activate shift'}
            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            {shift.is_active
              ? <ToggleRight size={18} className="text-[#1B5E20]" />
              : <ToggleLeft size={18} />}
          </button>
          {/* Edit */}
          <button
            onClick={() => setEditing(true)}
            className="px-2.5 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
          >Edit</button>
          {/* Delete */}
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button onClick={handleDelete} disabled={deleting}
                className="px-2 py-1 rounded-md text-xs font-bold bg-red-100 text-red-600 hover:bg-red-200 transition-colors">
                {deleting ? '…' : 'Yes'}
              </button>
              <button onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 rounded-md text-xs font-bold bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">
                No
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-md hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ── Edit / new row ── */
  return (
    <div className="border border-[#1B5E20]/20 rounded-lg bg-green-50/30 p-4 space-y-3">
      {/* Name */}
      <div className="flex gap-2 items-center">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Shift name (e.g. Lunch)"
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]/40"
        />
        <button onClick={() => { if (!isNew) setEditing(false); else onDeleted(); }}
          className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Days */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Days open</p>
        <div className="flex flex-wrap gap-1.5">
          {ALL_DAYS.map(d => (
            <button key={d}
              onClick={() => toggleDay(d)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                days.includes(d)
                  ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-[#1B5E20]/40'
              }`}
            >{DAY_LABELS[d]}</button>
          ))}
        </div>
      </div>

      {/* Times */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 font-medium w-10">From</label>
          <input type="time" value={start} onChange={e => setStart(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 font-medium w-5">To</label>
          <input type="time" value={end} onChange={e => setEnd(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30" />
        </div>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving || !name.trim() || !days.length || !start || !end}
        className="flex items-center gap-1.5 px-4 py-1.5 bg-[#1B5E20] text-white text-sm font-medium rounded-lg hover:bg-[#2E7D32] transition-colors disabled:opacity-40"
      >
        <Save size={14} />
        {saving ? 'Saving…' : 'Save Shift'}
      </button>
    </div>
  );
}

/* ── Shift panel for one location ─────────────────────────────────────────── */
function ShiftsPanel({ location }: { location: Location }) {
  const [addingNew, setAddingNew] = useState(false);

  const { data: shifts = [], isLoading } = useQuery<Shift[]>({
    queryKey: ['location_shifts', location.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('location_shifts')
        .select('*')
        .eq('location_id', location.id)
        .order('name');
      return (data ?? []) as Shift[];
    },
  });

  const activeShifts   = shifts.filter(s => s.is_active);
  const inactiveShifts = shifts.filter(s => !s.is_active);

  return (
    <div className="px-4 pb-5 pt-3 bg-gray-50 border-t border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          <Clock size={12} /> Shifts
        </span>
        <button
          onClick={() => setAddingNew(true)}
          className="flex items-center gap-1 text-xs font-semibold text-[#1B5E20] hover:text-[#2E7D32] transition-colors"
        >
          <Plus size={13} /> Add Shift
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Active shifts */}
          {activeShifts.map(s => (
            <ShiftRow key={s.id} shift={s} locationId={location.id} onSaved={() => {}} onDeleted={() => {}} />
          ))}

          {/* Inactive shifts (greyed out below) */}
          {inactiveShifts.length > 0 && (
            <>
              {activeShifts.length > 0 && <div className="border-t border-dashed border-gray-200 my-1" />}
              {inactiveShifts.map(s => (
                <ShiftRow key={s.id} shift={s} locationId={location.id} onSaved={() => {}} onDeleted={() => {}} />
              ))}
            </>
          )}

          {shifts.length === 0 && !addingNew && (
            <p className="text-xs text-gray-400 text-center py-3">No shifts defined yet.</p>
          )}

          {/* New shift editor */}
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
          <Plus size={16} />
          Add Location
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
                  {/* Location row */}
                  <button
                    onClick={() => toggle(loc.id)}
                    className="w-full text-left hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 px-4 py-3.5">
                      <div className="flex-shrink-0 text-gray-300">
                        {isOpen
                          ? <ChevronDown size={16} className="text-[#1B5E20]" />
                          : <ChevronRight size={16} />}
                      </div>
                      <div className="flex-1 grid grid-cols-[1.5fr_1fr_3fr_auto] gap-4 items-center text-sm">
                        <span className="font-semibold text-gray-900">{loc.name}</span>
                        <span className="text-gray-500 capitalize">{loc.type ?? '—'}</span>
                        <span className="text-gray-400 text-xs truncate">{loc.address ?? '—'}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          loc.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {loc.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                  </button>

                  {/* Shifts panel (collapsible) */}
                  {isOpen && <ShiftsPanel location={loc} />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-4">
        Click any location to expand its shift schedule. Toggle the switch to cancel / reinstate a shift.
      </p>
    </div>
  );
}
